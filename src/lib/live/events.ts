/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 (lane 2-c) — scheduled LIVE events.
 *
 * Server-authoritative discovery + lifecycle (work order §4H):
 *  - counts are ROW-derived (EventRegistration rows via _count), never
 *    client-claimed; register/unregister upsert/delete the unique
 *    (eventId, userId) row and are idempotent successes either way.
 *  - updates and cancels are CREATOR-only. Cancel is idempotent (an
 *    already-canceled event answers 200 with the dto).
 *  - `scheduledFor` law (pinned): must parse as an ISO date and be in the
 *    future beyond a 60s clock-skew grace on CREATE; on PATCH the future
 *    rule applies only while the event is still "scheduled" — terminal
 *    rows (completed/canceled) are historical records and may be moved to
 *    any valid ISO date.
 *  - roomId stays null in this lane: linking a broadcast to the event is
 *    the Phase 3 integration (when a room starts for the event).
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import { LiveDomainError, resolveLiveIdentity } from "./rooms";
import { EVENT_DESCRIPTION_MAX, EVENT_TITLE_MAX, RATE_LIMITS, resolveHandles } from "./permissions";
import type { CreateLiveEventInput, LiveEventDto } from "./types";

/** Clock-skew grace: "in the future" means more than this far ahead. */
const EVENT_FUTURE_GRACE_MS = 60_000;

/** Upcoming discovery default/max (the frozen contract: default 24, max 48). */
const UPCOMING_DEFAULT_LIMIT = 24;
const UPCOMING_MAX_LIMIT = 48;

/** Relaxed ISO-8601 date shape (date, optional time/zone — the honest parse). */
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A LiveEvent row with its registration count preloaded. */
type EventRow = Prisma.LiveEventGetPayload<{ include: { _count: { select: { registrations: true } } } }>;

function invalid(message: string): LiveDomainError {
  return new LiveDomainError("invalid", message);
}

function eventInclude() {
  return { _count: { select: { registrations: true } } } as const;
}

/** Parse + validate an ISO date string. Throws `invalid` when unusable. */
function parseIsoDate(value: unknown, field = "scheduledFor"): Date {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value.trim())) {
    throw invalid(`${field} must be an ISO date string`);
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) throw invalid(`${field} must be a valid ISO date`);
  return t;
}

/** Parse an ISO date that must still be in the future (beyond the grace). */
function parseFutureDate(value: unknown): Date {
  const t = parseIsoDate(value);
  if (t.getTime() <= Date.now() + EVENT_FUTURE_GRACE_MS) {
    throw invalid("scheduledFor must be in the future");
  }
  return t;
}

/** Map a row to the dto (creator display + caller registration flag resolved). */
function mapEvent(
  row: EventRow,
  registered: boolean | null,
  creator: { handle: string; name: string } | undefined,
): LiveEventDto {
  return {
    id: row.id,
    creatorId: row.creatorId,
    creatorHandle: creator?.handle ?? row.creatorId,
    creatorName: creator?.name ?? row.creatorId,
    title: row.title,
    description: row.description,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status as LiveEventDto["status"],
    roomId: row.roomId,
    registrationCount: row._count.registrations,
    registered,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Batch-map rows: creator handles + the caller's registration flags. */
async function eventDtos(
  rows: EventRow[],
  sessionUser: WebFlixSessionUser | null,
): Promise<LiveEventDto[]> {
  if (rows.length === 0) return [];
  const handles = await resolveHandles(rows.map((r) => r.creatorId));
  const registeredIds = new Set<string>();
  if (sessionUser) {
    const identity = await resolveLiveIdentity(sessionUser);
    const regs = await db.eventRegistration.findMany({
      where: { userId: identity.id, eventId: { in: rows.map((r) => r.id) } },
      select: { eventId: true },
    });
    for (const reg of regs) registeredIds.add(reg.eventId);
  }
  return rows.map((r) =>
    mapEvent(r, sessionUser ? registeredIds.has(r.id) : null, handles.get(r.creatorId)),
  );
}

/**
 * POST /api/live-events — any signed-in user schedules an event. Title
 * 1..EVENT_TITLE_MAX, description ≤ EVENT_DESCRIPTION_MAX, scheduledFor a
 * valid future ISO date (beyond the 60s grace).
 */
export async function createEvent(
  sessionUser: WebFlixSessionUser,
  input: CreateLiveEventInput,
): Promise<{ event: LiveEventDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 1 || title.length > EVENT_TITLE_MAX) {
    throw invalid(`title must be 1..${EVENT_TITLE_MAX} chars`);
  }
  let description: string | null = null;
  if (typeof input.description === "string") {
    description = input.description.trim();
    if (description.length > EVENT_DESCRIPTION_MAX) {
      throw invalid(`description must be at most ${EVENT_DESCRIPTION_MAX} chars`);
    }
    if (description === "") description = null;
  }
  const scheduledFor = parseFutureDate(input.scheduledFor);

  if (!(await rateLimit(`wf:live:events:create:${identity.id}`, RATE_LIMITS.eventCreate))) {
    throw new LiveDomainError("rate-limited");
  }

  const row = await db.liveEvent.create({
    data: { creatorId: identity.id, title, description, scheduledFor, status: "scheduled" },
    include: eventInclude(),
  });
  // The creator just made it — they cannot be registered yet (row-derived).
  return { event: mapEvent(row, false, { handle: identity.handle, name: identity.name }) };
}

/** GET /api/live-events?status=scheduled — public upcoming discovery, asc. */
export async function listUpcomingEvents(
  sessionUser: WebFlixSessionUser | null,
  opts: { limit?: number } = {},
): Promise<{ events: LiveEventDto[] }> {
  const limit = Math.min(Math.max(opts.limit ?? UPCOMING_DEFAULT_LIMIT, 1), UPCOMING_MAX_LIMIT);
  const rows = await db.liveEvent.findMany({
    where: { status: "scheduled" },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    include: eventInclude(),
  });
  return { events: await eventDtos(rows, sessionUser) };
}

/** GET /api/live-events/mine — the creator's own events, any status, newest first. */
export async function listMyEvents(
  sessionUser: WebFlixSessionUser,
): Promise<{ events: LiveEventDto[] }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);
  const rows = await db.liveEvent.findMany({
    where: { creatorId: identity.id },
    orderBy: { createdAt: "desc" },
    include: eventInclude(),
  });
  return { events: await eventDtos(rows, sessionUser) };
}

/** GET /api/live-events/[id] — public; carries the caller's registered flag. */
export async function getEvent(
  id: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<{ event: LiveEventDto }> {
  const row = await db.liveEvent.findUnique({ where: { id }, include: eventInclude() });
  if (!row) throw new LiveDomainError("not-found");
  const dtos = await eventDtos([row], sessionUser);
  return { event: dtos[0] };
}

/** The PATCH body shape (routes build it defensively; absent keys = untouched). */
export interface UpdateLiveEventPatch {
  title?: string;
  description?: string | null;
  scheduledFor?: string;
}

/**
 * PATCH /api/live-events/[id] — creator only. Validated exactly like
 * create; the scheduledFor future rule applies while the event is still
 * "scheduled" (terminal rows accept any valid ISO date — see the pinned
 * law in the file header).
 */
export async function updateEvent(
  id: string,
  sessionUser: WebFlixSessionUser,
  patch: UpdateLiveEventPatch,
): Promise<{ event: LiveEventDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);
  const row = await db.liveEvent.findUnique({ where: { id }, include: eventInclude() });
  if (!row) throw new LiveDomainError("not-found");
  if (row.creatorId !== identity.id) {
    throw new LiveDomainError("forbidden", "only the creator may edit an event");
  }

  const data: { title?: string; description?: string | null; scheduledFor?: Date } = {};
  if (patch.title !== undefined) {
    const title = typeof patch.title === "string" ? patch.title.trim() : "";
    if (title.length < 1 || title.length > EVENT_TITLE_MAX) {
      throw invalid(`title must be 1..${EVENT_TITLE_MAX} chars`);
    }
    data.title = title;
  }
  if (patch.description !== undefined) {
    if (patch.description === null) {
      data.description = null;
    } else {
      const description = typeof patch.description === "string" ? patch.description.trim() : "";
      if (description.length > EVENT_DESCRIPTION_MAX) {
        throw invalid(`description must be at most ${EVENT_DESCRIPTION_MAX} chars`);
      }
      data.description = description === "" ? null : description;
    }
  }
  if (patch.scheduledFor !== undefined) {
    const t = parseIsoDate(patch.scheduledFor);
    // PINNED RULE: the future rule (> now + 60s grace) applies only while
    // the event is "scheduled"; completed/canceled rows are historical.
    if (row.status === "scheduled" && t.getTime() <= Date.now() + EVENT_FUTURE_GRACE_MS) {
      throw invalid("scheduledFor must be in the future");
    }
    data.scheduledFor = t;
  }

  const updated = await db.liveEvent.update({ where: { id }, data, include: eventInclude() });
  return { event: (await eventDtos([updated], sessionUser))[0] };
}

/** POST /api/live-events/[id]/cancel — creator only; idempotent. */
export async function cancelEvent(
  id: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ event: LiveEventDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);
  const row = await db.liveEvent.findUnique({ where: { id }, include: eventInclude() });
  if (!row) throw new LiveDomainError("not-found");
  if (row.creatorId !== identity.id) {
    throw new LiveDomainError("forbidden", "only the creator may cancel an event");
  }
  if (row.status !== "canceled") {
    await db.liveEvent.update({ where: { id }, data: { status: "canceled" } });
  }
  const fresh =
    row.status === "canceled"
      ? row
      : await db.liveEvent.findUniqueOrThrow({ where: { id }, include: eventInclude() });
  return { event: (await eventDtos([fresh], sessionUser))[0] };
}

/** Load an event row (bare) or throw not-found. */
async function eventRowOr404(id: string) {
  const row = await db.liveEvent.findUnique({ where: { id } });
  if (!row) throw new LiveDomainError("not-found");
  return row;
}

/**
 * POST /api/live-events/[id]/register — upsert the unique (eventId, userId)
 * row. Idempotent success (registered again → still one row). Canceled and
 * completed events reject new registrations with `conflict`.
 */
export async function registerEvent(
  id: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ event: LiveEventDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);
  const row = await eventRowOr404(id);
  if (row.status === "canceled" || row.status === "completed") {
    throw new LiveDomainError("conflict", "event is not open for registration");
  }
  if (
    !(await rateLimit(`wf:live:events:register:${id}:${identity.id}`, RATE_LIMITS.eventRegister))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  await db.eventRegistration.upsert({
    where: { eventId_userId: { eventId: id, userId: identity.id } },
    create: { eventId: id, userId: identity.id },
    update: {},
  });
  return getEvent(id, sessionUser);
}

/**
 * DELETE /api/live-events/[id]/register — remove the caller's registration
 * row when present; idempotent success either way (leave-anytime law).
 */
export async function unregisterEvent(
  id: string,
  sessionUser: WebFlixSessionUser,
): Promise<{ event: LiveEventDto }> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");
  const identity = await resolveLiveIdentity(sessionUser);
  await eventRowOr404(id);
  if (
    !(await rateLimit(`wf:live:events:register:${id}:${identity.id}`, RATE_LIMITS.eventRegister))
  ) {
    throw new LiveDomainError("rate-limited");
  }
  await db.eventRegistration.deleteMany({ where: { eventId: id, userId: identity.id } });
  return getEvent(id, sessionUser);
}

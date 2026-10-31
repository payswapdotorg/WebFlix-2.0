"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 — Worker 3-d (UI lane): the non-monetary
 * gift surface (work order §4F, the non-monetary slice).
 *
 * Sandbox law (frozen, binding): gift credits are DEV credits with ZERO
 * cash value — the "Dev credits — no cash value" label is part of the
 * contract, always visible near the catalogue, never styled away. No
 * wallet, balance, purchase, or payout exists anywhere in this surface.
 *
 * Controlled-component law (this lane's pattern): the page owns the
 * catalogue, the feed, and the send pipeline (POST + stream fan-out).
 * This panel owns ONLY selection state (which item, how many, which
 * side) and the per-click idempotency key — it NEVER invents a send
 * result, NEVER appends to the feed from a response (rows arrive via
 * the server's dto array), and NEVER blocks on a guess: `canSend`,
 * `disabledReason`, `sending`, and `error` are the caller's honest
 * server-derived truth, rendered verbatim.
 */

import { useState } from "react";
import type { JSX } from "react";
import { Gift, Loader2, Minus, Plus, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  GiftCatalogItemDto,
  GiftEventDto,
  SendGiftInput,
} from "@/lib/live/types";

/**
 * Frozen numeric law — mirrors src/lib/live/permissions.ts GIFT_QTY_MAX
 * (mirrored, not imported: permissions.ts is server-only, it imports the
 * Prisma client, and this is a client component).
 */
const GIFT_QTY_MIN = 1;
const GIFT_QTY_MAX = 10;

export interface LiveGiftPanelProps {
  /** The active catalogue (server-seeded; empty → the honest dead end). */
  catalogue: GiftCatalogItemDto[];
  /** The room's gift feed, newest first — the server's order, verbatim. */
  gifts: GiftEventDto[];
  /** The caller's server-derived permission to send right now. */
  canSend: boolean;
  /** When canSend is false: the honest reason, rendered verbatim. */
  disabledReason?: string | null;
  /** True while the caller's POST is on the wire (spinner state). */
  sending?: boolean;
  /** The caller's last send failure — rendered as a destructive alert. */
  error?: string | null;
  /** Called once per send click with a fresh idempotency key. */
  onSend?: (input: SendGiftInput) => void;
  /** When an ACTIVE gift-scored match exists: the sides to support. */
  activeMatchTeams?: { id: string; label: string }[];
  className?: string;
}

export function LiveGiftPanel({
  catalogue,
  gifts,
  canSend,
  disabledReason = null,
  sending = false,
  error = null,
  onSend,
  activeMatchTeams,
  className,
}: LiveGiftPanelProps): JSX.Element {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(GIFT_QTY_MIN);
  // "" = "No side" — the default; the key is omitted from the payload.
  const [teamId, setTeamId] = useState("");

  const teams = activeMatchTeams ?? [];
  const hasCatalogue = catalogue.length > 0;

  // Effective selection: the picked item while it still exists, else the
  // first catalogue row (render-derived — no effects, no stale state).
  const picked =
    pickedId !== null ? (catalogue.find((c) => c.id === pickedId) ?? null) : null;
  const selected = picked ?? catalogue[0] ?? null;

  const sendDisabled = !canSend || sending || !hasCatalogue || onSend === undefined;

  function send(): void {
    if (sendDisabled || selected === null) return;
    // The component owns the idempotency key: ONE fresh clientRequestId
    // per click — a replayed intent is the server's dedupe to answer.
    onSend?.({
      giftItemId: selected.id,
      quantity,
      clientRequestId: crypto.randomUUID(),
      ...(teamId !== "" ? { matchTeamId: teamId } : {}),
    });
  }

  return (
    <Card className={cn("min-w-0 gap-4", className)}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="size-4 text-muted-foreground" aria-hidden />
          Gifts
        </CardTitle>
        {/* The frozen sandbox label — part of the contract, never omitted. */}
        <p
          data-testid="gift-sandbox-label"
          className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
        >
          Dev credits — no cash value
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasCatalogue ? (
          <div role="group" aria-label="Gift catalogue" data-testid="gift-catalogue">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {catalogue.map((item) => {
                const isSelected = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid="gift-item"
                    aria-pressed={isSelected}
                    onClick={() => setPickedId(item.id)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                        : "hover:bg-accent/60",
                    )}
                  >
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                      {item.priceCredits} dev credits
                    </span>
                    <span className="mt-1.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {item.animationKind}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p
            role="status"
            data-testid="gift-catalogue-empty"
            className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
          >
            Gift catalogue unavailable
          </p>
        )}

        {hasCatalogue && (
          <div className="flex flex-wrap items-end gap-3">
            {/* Quantity: 1..10 (the frozen GIFT_QTY_MAX law). */}
            <div className="space-y-1" data-testid="gift-quantity">
              <p className="text-xs font-medium text-foreground">Quantity</p>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Decrease quantity"
                  disabled={sendDisabled || quantity <= GIFT_QTY_MIN}
                  onClick={() => setQuantity((q) => Math.max(GIFT_QTY_MIN, q - 1))}
                  className="size-9"
                >
                  <Minus aria-hidden />
                </Button>
                <span
                  aria-live="polite"
                  className="w-8 text-center text-sm font-semibold tabular-nums text-foreground"
                >
                  {quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Increase quantity"
                  disabled={sendDisabled || quantity >= GIFT_QTY_MAX}
                  onClick={() => setQuantity((q) => Math.min(GIFT_QTY_MAX, q + 1))}
                  className="size-9"
                >
                  <Plus aria-hidden />
                </Button>
                <span className="ml-1 text-[11px] text-muted-foreground">
                  1–{GIFT_QTY_MAX}
                </span>
              </div>
            </div>

            {/* Support a side — only while a gift-scored match is running. */}
            {teams.length > 0 && (
              <div className="min-w-0 space-y-1" data-testid="gift-team-picker">
                <label
                  htmlFor="gift-team-picker-select"
                  className="block text-xs font-medium text-foreground"
                >
                  Support a side
                </label>
                <select
                  id="gift-team-picker-select"
                  aria-label="Support a side"
                  value={teamId}
                  disabled={sendDisabled}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="h-9 w-full max-w-52 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">No side</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {error !== null && (
          <Alert variant="destructive" data-testid="gift-error">
            <TriangleAlert aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Button
            type="button"
            data-testid="gift-send"
            onClick={send}
            disabled={sendDisabled}
            className="w-full"
          >
            {sending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Gift aria-hidden />
            )}
            {sending ? "Sending…" : selected !== null ? `Send ${selected.name}` : "Send gift"}
          </Button>
          {!canSend && disabledReason !== null && (
            <p
              role="note"
              data-testid="gift-disabled-reason"
              className="rounded-lg border border-dashed px-3 py-2 text-center text-sm text-muted-foreground"
            >
              {disabledReason}
            </p>
          )}
        </div>

        {/* The feed — the server's newest-first array, rendered verbatim. */}
        <div data-testid="gift-feed" className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent gifts
          </p>
          {gifts.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-muted-foreground">
              No gifts yet
            </p>
          ) : (
            <ul
              aria-label="Recent gifts"
              className="max-h-48 space-y-1 overflow-y-auto pr-1"
            >
              {gifts.map((gift) => (
                <li
                  key={gift.id}
                  className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5"
                >
                  <span className="min-w-0 truncate text-sm text-foreground">
                    <span className="font-medium">{gift.senderName}</span>
                    {" sent "}
                    {gift.quantity}
                    {" × "}
                    {gift.giftName}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {gift.totalCredits} dev credits
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Database,
  Gauge,
  HandHeart,
  LogIn,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { formatCount } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { LiveOpsOverviewDto } from "@/lib/live/types";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 4-OPS — the §4H operations dashboard
 * (ADR-0009, frozen contracts §6).
 *
 * Honest-state law, applied to operations:
 * - the gate states are the API's REAL answers: 401 → sign-in explainer,
 *   503 ops-admin-not-configured → the env-var explainer, 403 → restricted;
 * - every figure renders exactly what the server derived — nothing is
 *   zero-filled, and the typed unavailable blocks (provider costs, egress,
 *   outbox lag) render their REASONS;
 * - the attached-stream count is labelled instance-local (ADR-0006);
 * - the window is operator-selected (1h/24h/7d) and auto-refreshes every
 *   30s; every list is server-ranked, never client-sorted.
 */

const WINDOWS = [
  { label: "1h", ms: 3_600_000 },
  { label: "24h", ms: 24 * 3_600_000 },
  { label: "7d", ms: 7 * 24 * 3_600_000 },
] as const;

const REFRESH_MS = 30_000;

function msLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function bytesLabel(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

function TopList({
  entries,
  emptyCopy,
}: {
  entries: Array<{ key: string; count: number }>;
  emptyCopy: string;
}) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyCopy}</p>;
  }
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.key} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-mono" title={e.key}>
            {e.key}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">{formatCount(e.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function MetricCard({
  icon,
  title,
  children,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} className="p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </Card>
  );
}

function UnavailableLine({
  label,
  block,
}: {
  label: string;
  block: { status: string; reason: string; detail?: string };
}) {
  return (
    <li className="text-xs">
      <span className="font-medium">{label}</span>{" "}
      <Badge variant="outline" className="ml-1 font-mono text-[10px]">
        {block.reason}
      </Badge>
      {block.detail ? <p className="mt-0.5 text-muted-foreground">{block.detail}</p> : null}
    </li>
  );
}

export default function View() {
  const [windowMs, setWindowMs] = useState<number>(24 * 3_600_000);
  const { data, error, loading, reload } = useApi<LiveOpsOverviewDto>(
    `/api/live/ops/overview?windowMs=${windowMs}`,
  );

  // 30s freshness while the dashboard is on screen (ops, not media: a poll,
  // not the room stream).
  useEffect(() => {
    const t = setInterval(() => reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  if (error === "unauthenticated") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card className="p-6 text-center" data-testid="ops-gate-unauthenticated">
          <LogIn aria-hidden className="mx-auto mb-3 size-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Sign in to open Operations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The operations dashboard is restricted to WebFlix operators declared by this
            deployment.
          </p>
          <Button asChild className="mt-4">
            <Link href="/account">Sign in</Link>
          </Button>
        </Card>
      </main>
    );
  }

  if (error === "ops-admin-not-configured") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card className="p-6 text-center" data-testid="ops-gate-not-configured">
          <ShieldAlert aria-hidden className="mx-auto mb-3 size-10 text-amber-500" />
          <h1 className="text-lg font-semibold">Operations are locked on this deployment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No operator allowlist is declared. The deployment owner must set{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">
              WEBFLIX_OPS_ADMIN_EMAILS
            </code>{" "}
            (comma-separated operator emails) to unlock this dashboard. Nothing is faked in the
            meantime.
          </p>
        </Card>
      </main>
    );
  }

  if (error === "forbidden") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card className="p-6 text-center" data-testid="ops-gate-forbidden">
          <ShieldAlert aria-hidden className="mx-auto mb-3 size-10 text-rose-500" />
          <h1 className="text-lg font-semibold">This area is restricted</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account isn&apos;t on this deployment&apos;s operator allowlist.
          </p>
        </Card>
      </main>
    );
  }

  const overview = data;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="ops-dashboard">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Activity aria-hidden className="size-5 text-emerald-500" />
            LIVE Operations
          </h1>
          <p className="text-sm text-muted-foreground">
            Derived server-side from durable rows — observations, never claims.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Overview window" className="flex overflow-hidden rounded-md border">
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => setWindowMs(w.ms)}
                aria-pressed={windowMs === w.ms}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  windowMs === w.ms
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh now">
            <RefreshCw aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      {loading && !overview ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : error === "rate-limited" ? (
        <Alert>
          <Timer aria-hidden />
          <AlertTitle>Slow down</AlertTitle>
          <AlertDescription>
            The overview endpoint is rate-limited — it will refresh automatically.
          </AlertDescription>
        </Alert>
      ) : error || !overview ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>Couldn&apos;t load the overview</AlertTitle>
          <AlertDescription>{error ?? "Unknown error"}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ── Room lifecycle ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={<Radio aria-hidden className="size-4 text-rose-500" />} title="Live rooms now" testId="ops-live-now">
              <p className="text-3xl font-bold tabular-nums">{overview.rooms.liveNow}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCount(overview.rooms.startedInWindow)} started ·{" "}
                {formatCount(overview.rooms.endedInWindow)} ended in window
              </p>
            </MetricCard>
            <MetricCard icon={<Gauge aria-hidden className="size-4 text-emerald-500" />} title="Time to first frame" testId="ops-ttff">
              {overview.media.ttff.count === 0 ? (
                <p className="text-xs text-muted-foreground">No frame observations in window.</p>
              ) : (
                <>
                  <p className="text-3xl font-bold tabular-nums">{msLabel(overview.media.ttff.p50Ms)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    p50 · p95 {msLabel(overview.media.ttff.p95Ms)} · n={overview.media.ttff.count}
                  </p>
                </>
              )}
            </MetricCard>
            <MetricCard icon={<Timer aria-hidden className="size-4 text-teal-500" />} title="Chat commit latency" testId="ops-chat-latency">
              {overview.chatLatency.count === 0 ? (
                <p className="text-xs text-muted-foreground">No latency samples in window.</p>
              ) : (
                <>
                  <p className="text-3xl font-bold tabular-nums">{msLabel(overview.chatLatency.p50Ms)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    p50 · p95 {msLabel(overview.chatLatency.p95Ms)} · n={overview.chatLatency.count}
                  </p>
                </>
              )}
            </MetricCard>
            <MetricCard icon={<HandHeart aria-hidden className="size-4 text-violet-500" />} title="Moderation pressure" testId="ops-moderation">
              <p className="text-3xl font-bold tabular-nums">{formatCount(overview.moderation.actions)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                actions · {formatCount(overview.moderation.reports)} reports in window
              </p>
            </MetricCard>
          </div>

          {/* ── Media + limits + provider ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard icon={<Activity aria-hidden className="size-4 text-amber-500" />} title="Media reliability">
              <ul className="space-y-1.5 text-xs">
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Reconnects recovered</span>
                  <span className="font-semibold tabular-nums">{formatCount(overview.media.reconnects)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Join errors</span>
                  <span className="font-semibold tabular-nums">{formatCount(overview.media.joinErrors.count)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Media errors</span>
                  <span className="font-semibold tabular-nums">{formatCount(overview.media.mediaErrors.count)}</span>
                </li>
              </ul>
              <div className="mt-2 space-y-2 border-t pt-2">
                <TopList entries={overview.media.joinErrors.top} emptyCopy="No join errors." />
                <TopList entries={overview.media.mediaErrors.top} emptyCopy="No media errors." />
              </div>
            </MetricCard>
            <MetricCard icon={<ShieldAlert aria-hidden className="size-4 text-orange-500" />} title="Rate-limit denials">
              <p className="text-3xl font-bold tabular-nums">{formatCount(overview.rateLimits.count)}</p>
              <div className="mt-2 border-t pt-2">
                <TopList entries={overview.rateLimits.top} emptyCopy="No denials in window." />
              </div>
            </MetricCard>
            <MetricCard icon={<ShieldCheck aria-hidden className="size-4 text-rose-500" />} title="Provider">
              <p className="text-sm">
                <span className="text-2xl font-bold tabular-nums">{formatCount(overview.provider.errors.count)}</span>{" "}
                <span className="text-xs text-muted-foreground">errors in window</span>
              </p>
              <div className="mt-2 border-t pt-2">
                <TopList entries={overview.provider.errors.top} emptyCopy="No provider errors." />
              </div>
              <ul className="mt-2 space-y-1.5 border-t pt-2">
                <UnavailableLine label="Costs" block={overview.provider.costs} />
                <UnavailableLine label="Egress" block={overview.provider.egress} />
              </ul>
            </MetricCard>
          </div>

          {/* ── Transport + storage ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard icon={<Radio aria-hidden className="size-4 text-teal-500" />} title="Transport (this instance)">
              <ul className="space-y-1.5 text-xs">
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Attached SSE streams</span>
                  <span className="font-semibold tabular-nums">
                    {formatCount(overview.transport.attachedStreamsThisInstance)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">DB-tail flush cadence</span>
                  <span className="font-semibold tabular-nums">{overview.transport.tailFlushMs}ms</span>
                </li>
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Instance-local by design (ADR-0006) — not a fleet-wide figure.
              </p>
              <ul className="mt-2 space-y-1.5 border-t pt-2">
                <UnavailableLine label="Outbox lag" block={overview.transport.outbox} />
              </ul>
            </MetricCard>
            <MetricCard icon={<Database aria-hidden className="size-4 text-emerald-500" />} title="Replay storage">
              <p className="text-3xl font-bold tabular-nums">{bytesLabel(overview.storage.replayBytes)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCount(overview.storage.replayAssets)} replay assets (the one real
                stored-volume fact)
              </p>
            </MetricCard>
            <MetricCard icon={<RefreshCw aria-hidden className="size-4 text-teal-500" />} title="End reconciles">
              <p className="text-3xl font-bold tabular-nums">{formatCount(overview.reconciles.endReconciles)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Sessions reconciled in window</p>
              {overview.rooms.endReasons.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t pt-2">
                  {overview.rooms.endReasons.map((r) => (
                    <li key={r.key} className="flex justify-between text-xs">
                      <span className="font-mono">{r.key}</span>
                      <span className="font-semibold tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </MetricCard>
          </div>

          {/* ── High-volume rooms ── */}
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity aria-hidden className="size-4" />
              High-volume rooms ({overview.windowMs / 3_600_000 >= 24 ? `${Math.round(overview.windowMs / 86_400_000)}d` : `${Math.round(overview.windowMs / 3_600_000)}h`} window)
            </div>
            {overview.volume.rooms.length === 0 ? (
              <p className="text-xs text-muted-foreground">No room activity in window.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-md border" data-testid="ops-volume-table">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                    <tr className="text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Room</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">Sessions</th>
                      <th className="px-3 py-2 text-right font-medium">Chat</th>
                      <th className="px-3 py-2 text-right font-medium">Hearts</th>
                      <th className="px-3 py-2 text-right font-medium">Gifts</th>
                      <th className="px-3 py-2 text-right font-medium">Matches</th>
                      <th className="px-3 py-2 text-right font-medium">Peak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.volume.rooms.map((r) => (
                      <tr key={r.roomId} className="border-t">
                        <td className="max-w-48 truncate px-3 py-2" title={`${r.title} — ${r.hostHandle}`}>
                          <Link href={`/live/${r.roomId}`} className="hover:underline">
                            {r.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={r.status === "live" ? "default" : "outline"} className="text-[10px]">
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.sessions}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.chatMessages)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.reactionHearts)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.giftEvents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.matches}</td>
                        <td className="px-3 py-2 text-right tabular-nums">≈{formatCount(r.peakViewers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Generated {new Date(overview.generatedAt).toLocaleString()} · auto-refreshes every 30s ·
            every figure is server-derived from durable rows (ADR-0009); what this deployment cannot
            measure is stated with a reason, never zero-filled.
          </p>
        </div>
      )}
    </main>
  );
}

"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Parity P72 — the room's PK banner (ADR-0012): the
 * cross-room battle state as THIS room sees it. The state is fetched (GET
 * /pk — the lazy finalize runs inside the read) and kept fresh by the
 * `pk` stream envelopes via the page's ONE stream. Every number rendered is
 * the server's derivation; this component never invents a score.
 *
 * Honest states: open ("waiting for an opponent"), active (both sides'
 * derived scores + the mySide marker + the countdown from endsAt), final
 * (the winner + the MVP line), cancelled (a one-line honest close), none
 * (the banner does not render at all).
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Swords } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LivePkBattleDto, LiveStreamEvent } from "@/lib/live/types";

export function LivePkBanner({
  roomId,
  latestEnvelope,
  className,
}: {
  roomId: string;
  latestEnvelope: LiveStreamEvent | null;
  className?: string;
}): JSX.Element | null {
  const [battle, setBattle] = useState<LivePkBattleDto | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/live-rooms/${roomId}/pk`, { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { battle?: LivePkBattleDto | null };
      setBattle(body.battle ?? null);
    }
    setLoaded(true);
  }, [roomId]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // The `pk` envelope IS the fresh state (pair/finalize/cancel all publish
  // to both rooms) — the render-phase adjustment pattern (latched by the
  // previously seen envelope id, never an effect).
  const [seenPkEventId, setSeenPkEventId] = useState<string | null>(null);
  if (
    latestEnvelope &&
    latestEnvelope.kind === "pk" &&
    latestEnvelope.eventId !== seenPkEventId
  ) {
    setSeenPkEventId(latestEnvelope.eventId);
    setBattle(latestEnvelope.battle);
  }

  if (!loaded || !battle || battle.status === "cancelled") return null;

  const mySide = battle.mySide;
  const sideLabel = (side: "a" | "b") =>
    side === mySide ? "Your room" : "The other room";
  const secondsLeft = Math.max(
    0,
    Math.round((new Date(battle.endsAt).getTime() - new Date(battle.serverNow).getTime()) / 1000),
  );

  return (
    <Card
      data-testid="pk-banner"
      className={cn("min-w-0 gap-3 border-primary/30", className)}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Swords className="size-4 text-primary" aria-hidden />
          PK battle
          {battle.mySide !== null && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
              you are side {battle.mySide}
            </span>
          )}
        </CardTitle>
        {battle.status === "active" && (
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="pk-countdown">
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} left
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {battle.status === "open" && (
          <p data-testid="pk-open" className="text-sm text-muted-foreground">
            Challenge open — waiting for another live host to accept. Their room&apos;s reactions
            and gifts will count as their side&apos;s score.
          </p>
        )}
        {(battle.status === "active" || battle.status === "final") && (
          <div className="space-y-1.5" data-testid="pk-sides">
            {(["a", "b"] as const).map((side) => {
              const s = side === "a" ? battle.sideA : battle.sideB;
              if (!s) return null;
              const winner = battle.winnerSide === side;
              return (
                <div
                  key={side}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm",
                    winner && "border-primary/40 bg-primary/5",
                  )}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{s.title}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">{sideLabel(side)}</span>
                    {winner && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-primary">
                        winner
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {s.score} pts
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {battle.status === "final" && (
          <p data-testid="pk-result" className="text-xs text-muted-foreground">
            {battle.winnerSide
              ? battle.mvp
                ? `Final — side ${battle.winnerSide} wins. MVP: ${battle.mvp.displayName} (${battle.mvp.points} pts).`
                : `Final — side ${battle.winnerSide} wins.`
              : "Final — a tie: nobody wins this one."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

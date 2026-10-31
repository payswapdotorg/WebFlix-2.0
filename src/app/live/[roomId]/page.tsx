import View from "./view";

export const metadata = { title: "WebFlix LIVE room" };

/**
 * WFX2-LIVE-PLATFORM-1 §7 Worker 2 — the viewer-room shell for /live/[roomId].
 *
 * Static chrome only: the room's live state (title, session lifecycle, token
 * minting, LiveKit playback) is all client-side — every datum is fetched from
 * the force-dynamic /api/live-rooms routes by ./view.tsx, so this shell never
 * answers with a stale room state. The root AppShell provides the topbar/
 * sidebar/footer chrome. The playback token minted for the viewer lives ONLY
 * in the renderer's memory — never in a URL, a log line or a persisted row.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <View roomId={roomId} />;
}

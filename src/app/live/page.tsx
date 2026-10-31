import View from "./view";

export const metadata = { title: "WebFlix LIVE" };

/**
 * WFX2-LIVE-PLATFORM-1 §7 Worker 2 — the first-party /live discovery shell.
 *
 * Deliberately separate from /explore/live (that route stays YouTube's live
 * search surface): this page renders ONLY WebFlix-owned rooms. The page
 * chrome (topbar, sidebar, footer) comes from the root AppShell — this shell
 * adds nothing but metadata; every datum is client-fetched from the
 * force-dynamic /api/live-rooms routes by ./view.tsx.
 */
export default function Page() {
  return <View />;
}

import View from "./view";

export const revalidate = 3600;

export const metadata = { title: "Go live" };

/**
 * WFX2-LIVE-PLATFORM-1 (Worker 3) — the Creator Go Live shell.
 *
 * ISR shell idiom (the /upload and /account/* pattern): the page chrome is
 * static and revalidated hourly; every live datum is client-fetched from the
 * force-dynamic /api/live-rooms routes. The client surface — the Go Live
 * preflight (title, visibility, honest device test) and the live console —
 * lives in ./view.tsx.
 *
 * Layout law: this surface follows the app shell (the root AppShell owns the
 * navbar/sidebar); no footer or nav of its own — the view renders a
 * max-width card-based container only.
 */
export default function Page() {
  return <View />;
}

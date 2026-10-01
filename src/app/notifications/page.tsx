import View from "./view";

export const revalidate = 3600;

export const metadata = { title: "Notifications" };

/**
 * WFX2-P4-NC — the notification center (the bell's "See all" destination):
 * the ISR shell pattern (history/page.tsx) — the page chrome is static and
 * revalidated hourly; every datum stays client-fetched from the dynamic
 * /api/notifications/center route (force-dynamic lives there by law). The
 * client surface itself lives in ./view.tsx.
 */
export default function Page() {
  return <View />;
}

import type { Metadata } from "next";
import NetflixWatchView from "./view";

export const metadata: Metadata = {
  title: { absolute: "Watch — Netflix on WebFlix" },
};

/**
 * P43 — the in-app Netflix watch experience: the live cloud-desktop session
 * (real Chrome + Widevine) streamed into WebFlix, driven by the official
 * per-title deep link (netflix.com/watch/<id>).
 *
 * P51-AUDIT (report §3.1 A4): the view is KEYED by the dynamic segment —
 * App Router does not remount a page when only the param changes, and the
 * unkeyed lane kept the previous title's iframe/kick when navigating
 * /netflix/watch/<id> → /netflix/watch/live. A key change is a fresh lane.
 */
export default async function NetflixWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NetflixWatchView key={id} />;
}

import type { Metadata } from "next";
import NetflixWatchView from "./view";

export const metadata: Metadata = {
  title: "Watch — Netflix on WebFlix",
};

/**
 * P43 — the in-app Netflix watch experience: the live cloud-desktop session
 * (real Chrome + Widevine) streamed into WebFlix, driven by the official
 * per-title deep link (netflix.com/watch/<id>).
 */
export default function NetflixWatchPage() {
  return <NetflixWatchView />;
}

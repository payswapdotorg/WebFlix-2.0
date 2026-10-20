import type { Metadata } from "next";
import View from "./view";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Music",
};

/**
 * P30 — the dedicated music page (youtube.com's own /music destination,
 * measured live 2026-10-20: the channel-style header + the shelf family of
 * square lockups). The ISR shell pattern (the podcasts-destination idiom):
 * the page chrome is static and revalidated hourly; every datum stays
 * client-fetched from the dynamic /api/music route (force-dynamic stays
 * there by law).
 */
export default function Page() {
  return <View />;
}

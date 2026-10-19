import type { Metadata } from "next";
import View from "./view";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Podcasts",
};

/**
 * P25 G13 — the dedicated podcasts page (youtube.com's own
 * /podcasts destination, measured live 2026-10-19: the
 * FEpodcasts_destination surface serves its REAL public shape from this
 * egress — the header + the shelf family, NOT the REA-3B nudge shell).
 * The ISR shell pattern (the explore/live + explore/category idiom): the
 * page chrome is static and revalidated hourly; every datum stays
 * client-fetched from the dynamic /api/podcasts route (force-dynamic
 * stays there by law).
 */
export default function Page() {
  return <View />;
}

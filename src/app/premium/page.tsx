import type { Metadata } from "next";
import PremiumView from "./view";

export const metadata: Metadata = {
  title: "WebFlix Premium",
  description: "WebFlix has no paid tier — everything here is free.",
};

/**
 * WFX2-P20 — the WebFlix Premium page shell.
 *
 * The page mirrors youtube.com/premium's full STRUCTURE (hero band, plan
 * comparison, benefits, FAQ accordion, footer links row) — depth pass over
 * the P5-SS skeleton. The honest-absence doctrine is unchanged and
 * deepened: every paid surface is YouTube's real product labeled
 * ON YOUTUBE.COM, WebFlix has no paid tier, nothing is gated, and no
 * checkout affordance exists anywhere. The interactive layout (the FAQ
 * accordion) lives in ./view.tsx.
 */
export default function PremiumPage() {
  return <PremiumView />;
}

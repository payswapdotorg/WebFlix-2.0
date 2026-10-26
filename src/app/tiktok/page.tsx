import { TikTokHubView } from "./view";

export const revalidate = 3600;

export const metadata = {
  title: { absolute: "TikTok on WebFlix" },
  description:
    "Watch WebFlix's curated TikTok shelf through TikTok's own official embed player — attribution intact, playback rides TikTok.",
};

/**
 * P58 — ISR shell (the house pattern, mirroring /netflix): static chrome,
 * hourly revalidate, all data client-fetched from the dynamic /api/tiktok
 * routes.
 */
export default function Page() {
  return <TikTokHubView />;
}

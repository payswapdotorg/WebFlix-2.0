import { redirect } from "next/navigation";
import { isTikTokPostId } from "@/lib/tiktok/urls";

/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 (ADR 0013 §7) — the old one-post page is
 * now a compatibility deep link INTO the shared Shorts experience: it opens
 * the TikTok feed at that post (`/shorts?source=tiktok&post=<id>`). There
 * is still no second playback UI — the work order's law. An invalid id
 * still lands in the TikTok feed (the feed renders honestly; the old
 * invalid-id card is superseded by the shared surface).
 */
export const metadata = {
  title: { absolute: "TikTok player on WebFlix" },
  description: "Watch a TikTok post inside WebFlix Shorts through TikTok's official embed player.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(
    isTikTokPostId(id)
      ? `/shorts?source=tiktok&post=${encodeURIComponent(id)}`
      : "/shorts?source=tiktok",
  );
}

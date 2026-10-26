import { TikTokPostView } from "./view";

export const revalidate = 3600;

export const metadata = {
  title: { absolute: "TikTok player on WebFlix" },
  description: "Watch a curated TikTok post through TikTok's official embed player.",
};

/** P58 — the in-app playback page shell (ISR, the house pattern). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TikTokPostView postId={id} />;
}

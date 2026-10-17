import { SoundPageView } from "./view";
import { getSoundPage, normalizeSoundKeyParam } from "@/lib/youtube/sound";

/**
 * WFX2-P23-C (G5) — the sound page route: /sound/<key>.
 *
 * youtube.com's own sound surface (measured 2026-10-17): the pivot disc's
 * audio-pivot grid — a sound card (title + vertical 2:3 image + the owner
 * channel) above a grid of the shorts that use the sound, with browse
 * continuation paging. WebFlix's key is the URL-encoded audio-pivot
 * continuation token (the exact identity the feed's own data carries — the
 * WEB payloads ship no shorter sound id; measured, see
 * evidence/wfx2p23c/DISCOVERY.md).
 *
 * NEXT 16 MEASURED: page route params arrive UNDECODED — normalizeSoundKeyParam
 * collapses the link form back to the raw token (dev-server verified).
 *
 * The resolve here is the same cached read the view's API call rides, so the
 * double read costs one cache hit; a failed read degrades the title honestly.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const page = await getSoundPage(normalizeSoundKeyParam(key)).catch(
    () => null,
  );
  if (page?.title) return { title: `${page.title} - WebFlix` };
  return { title: "Sound - WebFlix" };
}

export default async function SoundRoute({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  // key → fresh mount per sound (client state resets naturally)
  return <SoundPageView key={key} soundKey={key} />;
}

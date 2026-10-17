/**
 * WFX2-P23-C (G5) — the sound page read: the shorts that use a sound.
 *
 * youtube.com's own mechanism (measured live 2026-10-17 —
 * evidence/wfx2p23c/DISCOVERY.md + browse_audio_pivot_page1.json): a sound's
 * grid is a BROWSE CONTINUATION. The reel sequence's pivot disc (the sound
 * attribution) ships the token via its `engagement-panel-shorts-audio-pivot`
 * engagement panel; POST /youtubei/v1/browse {continuation} answers:
 *  - header.pageHeaderRenderer.content.pageHeaderViewModel — the sound card:
 *    title (the sound title) · image (contentPreviewImageViewModel, vertical
 *    2:3) · metadataRows (an avatarStack carrying the @handle + channel link)
 *  - onResponseReceivedActions[].reloadContinuationItemsCommand — slot BODY
 *    (targetId "browse-feedFEsfv_audio_pivot") with continuationItems[] =
 *    richItemRenderer.shortsLockupViewModel (the shorts grid — mapped by the
 *    house mapShortsLockup) + a trailing continuationItemRenderer (the next
 *    page's token — paging verified live).
 *
 * The sound's identity this app carries is the token itself (the feed's own
 * data carries no shorter sound id — measured: no /sound/<id> URLs anywhere
 * in the WEB payloads; the 2026 desktop disc opens the panel, the mobile DOM
 * composes /source/<videoId>/shorts for ORIGINAL sounds only). /sound/<key>
 * is therefore keyed by the URL-encoded continuation token — the exact read
 * youtube.com's own pivot performs. Honest degradation when the browse fails
 * or yields nothing: the route's unavailable family (never a fake grid).
 */
import { innertubeBrowse } from "./innertube";
import { cached, TTL } from "./cache";
import { mapShortsLockup, type ShortDTO } from "./shorts";

export type SoundPageDTO = {
  /** The sound's title (pageHeaderViewModel.title — measured). */
  title: string;
  /** The sound card image (contentPreviewImageViewModel — vertical 2:3). */
  imageUrl: string | null;
  /** The sound's owner channel (metadataRows avatarStack — measured). */
  channel: { id: string; handle: string | null; avatarUrl: string | null } | null;
  /** The shorts using the sound (shortsLockupViewModels, in feed order). */
  items: ShortDTO[];
  /** The next browse continuation token (paging), when youtube.com served one. */
  nextCursor: string | null;
  /** The number of shorts loaded so far (across pages — the "N shorts" line). */
  totalLoaded: number;
};

/**
 * Normalize a /sound/<key> route param back to the browse token.
 *
 * The token contains literal '%3D' sequences (protobuf base64), so the link
 * side encodeURIComponent's the RAW token and Next.js decodes route params
 * EXACTLY ONCE — the param arrives as the raw token already. A second decode
 * here would mangle it ("Q%3D%3D" → "Q=="); the identity is the correct,
 * measured behavior. Malformed keys pass through and fail honestly upstream.
 */
export function soundKeyToToken(key: string): string {
  return key;
}

/** The /sound/<key> link for a sound token (the disc's href). */
export function soundTokenToKeyLink(token: string): string {
  return `/sound/${encodeURIComponent(token)}`;
}

/**
 * Walk one browse continuation response for the reload commands' shorts
 * lockups + the next token (the measured onResponseReceivedActions shape).
 */
export function mapSoundPageResponse(
  browseResponse: unknown,
): { items: ShortDTO[]; nextCursor: string | null } {
  const root = (browseResponse ?? {}) as Record<string, unknown>;
  const items: ShortDTO[] = [];
  const seen = new Set<string>();
  let nextCursor: string | null = null;
  const actions = Array.isArray(root.onResponseReceivedActions)
    ? (root.onResponseReceivedActions as unknown[])
    : [];
  for (const a of actions) {
    const cmd = (a as Record<string, unknown>)?.reloadContinuationItemsCommand as
      | Record<string, unknown>
      | undefined;
    if (!cmd) continue;
    const continuationItems = Array.isArray(cmd.continuationItems)
      ? (cmd.continuationItems as unknown[])
      : [];
    for (const itemRaw of continuationItems) {
      const item = itemRaw as Record<string, unknown>;
      const rich = item?.richItemRenderer as Record<string, unknown> | undefined;
      if (rich?.content) {
        const dto = mapShortsLockup(rich.content);
        if (dto && !seen.has(dto.id)) {
          seen.add(dto.id);
          items.push(dto);
        }
        continue;
      }
      const cir = item?.continuationItemRenderer as
        | Record<string, unknown>
        | undefined;
      if (cir) {
        const token = (
          (cir.continuationEndpoint as Record<string, unknown>)
            ?.continuationCommand as Record<string, unknown>
        )?.token;
        if (typeof token === "string" && token) nextCursor = token;
      }
    }
  }
  return { items, nextCursor };
}

/** Map the sound card (pageHeaderViewModel) off a browse response. */
export function mapSoundCard(
  browseResponse: unknown,
): {
  title: string;
  imageUrl: string | null;
  channel: SoundPageDTO["channel"];
} {
  const root = (browseResponse ?? {}) as Record<string, unknown>;
  const header = root.header as Record<string, unknown> | undefined;
  const phr = header?.pageHeaderRenderer as Record<string, unknown> | undefined;
  const title = typeof phr?.pageTitle === "string" ? phr.pageTitle : "";

  const content = phr?.content as Record<string, unknown> | undefined;
  const vm = content?.pageHeaderViewModel as Record<string, unknown> | undefined;

  // image: contentPreviewImageViewModel.image.sources[] (last = biggest)
  let imageUrl: string | null = null;
  const img = (vm?.image as Record<string, unknown>)?.contentPreviewImageViewModel as
    | Record<string, unknown>
    | undefined;
  const sources = Array.isArray(
    (img?.image as Record<string, unknown> | undefined)?.sources,
  )
    ? ((img?.image as Record<string, unknown>).sources as unknown[])
    : [];
  for (const s of sources) {
    const u = (s as Record<string, unknown>)?.url;
    if (typeof u === "string" && u) imageUrl = u;
  }

  // channel: metadataRows[].metadataParts[].avatarStack.avatarStackViewModel
  //   {avatars[0].avatarViewModel.image.sources[last], text.content "@handle",
  //    rendererContext…commandContext…browseEndpoint.browseId}
  let channel: SoundPageDTO["channel"] = null;
  const metadata = (vm?.metadata as Record<string, unknown>)
    ?.contentMetadataViewModel as Record<string, unknown> | undefined;
  const rows = Array.isArray(metadata?.metadataRows)
    ? (metadata.metadataRows as unknown[])
    : [];
  for (const row of rows) {
    const parts = Array.isArray((row as Record<string, unknown>)?.metadataParts)
      ? ((row as Record<string, unknown>).metadataParts as unknown[])
      : [];
    for (const part of parts) {
      const stack = (part as Record<string, unknown>)?.avatarStack as
        | Record<string, unknown>
        | undefined;
      const stackVm = stack?.avatarStackViewModel as
        | Record<string, unknown>
        | undefined;
      if (!stackVm) continue;
      const avatars = Array.isArray(stackVm.avatars)
        ? (stackVm.avatars as unknown[])
        : [];
      const avatarVm = (avatars[0] as Record<string, unknown>)
        ?.avatarViewModel as Record<string, unknown> | undefined;
      let avatarUrl: string | null = null;
      const avatarSources = Array.isArray(
        (avatarVm?.image as Record<string, unknown> | undefined)?.sources,
      )
        ? ((avatarVm?.image as Record<string, unknown>).sources as unknown[])
        : [];
      for (const s of avatarSources) {
        const u = (s as Record<string, unknown>)?.url;
        if (typeof u === "string" && u) avatarUrl = u;
      }
      const text = (stackVm.text as Record<string, unknown>)?.content;
      const onTap = (stackVm.rendererContext as Record<string, unknown>)
        ?.commandContext as Record<string, unknown> | undefined;
      const innertube = (onTap?.onTap as Record<string, unknown>)
        ?.innertubeCommand as Record<string, unknown> | undefined;
      const browse = innertube?.browseEndpoint as
        | Record<string, unknown>
        | undefined;
      const id = typeof browse?.browseId === "string" ? browse.browseId : "";
      const rawHandle = typeof text === "string" ? text : "";
      const handle = rawHandle.startsWith("@") ? rawHandle.slice(1) : rawHandle || null;
      channel = { id, handle, avatarUrl };
    }
  }
  return { title, imageUrl, channel };
}

/**
 * Read one sound page (the browse continuation). `token` is the audio-pivot
 * browse continuation the feed's pivot disc carries; `totalLoaded` rides for
 * the "N shorts" count across pages (display state, never part of the read
 * key — the same token always answers the same page). Cached 5 minutes.
 */
export async function getSoundPage(
  token: string,
  totalLoaded = 0,
): Promise<SoundPageDTO> {
  const response = await cached(`yt:soundpage:${token}`, TTL.FEED_MS, () =>
    innertubeBrowse({ continuation: token }),
  );
  const card = mapSoundCard(response);
  const { items, nextCursor } = mapSoundPageResponse(response);
  return {
    title: card.title,
    imageUrl: card.imageUrl,
    channel: card.channel,
    items,
    nextCursor,
    totalLoaded: totalLoaded + items.length,
  };
}

# ADR 0004 — TikTok source policy: official Embed Player, keyless oEmbed, curated library

Status: Accepted (2026-10-26)
Supersedes: nothing. Applies ADR 0002's multi-source law to the third source.
Related: docs/research/2026-10-26-tiktok-integration-options.md, docs/work-items/P58-TIKTOK-SOURCE.md

## Context

After Netflix (ADR 0002, deep-link hand-off — its DRM forbids in-app playback),
TikTok is the next source, with the OPPOSITE transport reality: TikTok officially
supports third-party embedding (Embed Player, `www.tiktok.com/player/v1/<postId>`,
last doc update 2026-10-22) and publishes a keyless oEmbed endpoint. In-app
playback is therefore legal without credentials — but TikTok publishes NO feed
API, and bot-gates its whole web domain from datacenter egress (measured
2026-10-26: every path, robots.txt included, 302s to /hk/about).

## The decision

1. **Playback — TikTok's own player, in-app.** The official Embed Player iframe,
   constructed ONLY in `src/lib/tiktok/urls.ts`. Viewer-browser-side (immune to
   our egress walls); no proxying, caching, or extraction of TikTok media bytes.
   Legacy blockquote.js is skipped (officially deprecated).
2. **Metadata — keyless oEmbed through the source-adapter seams.** Server-side
   only via the injectable `upstream.ts`; cached via the shared Upstash adapter
   (soft TTL 6h/24h + last-good, own `tt:*` keyspace); honest provenance
   (`tiktok-oembed | tiktok-curated | last-good | ""` + `unavailable`/reason);
   everything beyond `embed_product_id` optional.
3. **Library — curated, bounded, env-overridable.** In-repo seed list +
   `TIKTOK_CURATED_IDS` (URLs or bare postIds, deduped, cap 40). No Prisma
   tables in v1. No scraping (robots.txt unverifiable from this egress —
   ADR 0002 §2 read policy), no Data API (operator-gated), no Apify harvest
   (documented future pool, not a dependency).
4. **Surfaces — additive only.** Sidebar `/tiktok` row; `/tiktok` hub (ISR shell
   + client view); `/tiktok/v/<postId>` playback page with honest
   `onPlayerError` banners (1001/2001/3001/3002) and outbound attribution;
   `/api/tiktok/rail` + `/api/tiktok/video/<postId>`; a global-search shelf that
   renders only when the curated library answers. YouTube surfaces byte-identical.
5. **Errors are data.** Player failures surface as honest states with the
   outbound TikTok link intact — never a silent black frame.

## Compliance

- Embedding is TikTok's licensed path (Share → Embed / official docs);
  attribution rides the player; outbound links return traffic to tiktok.com.
- Zero new secrets (oEmbed keyless); one optional env var.
- Rate impact: one oEmbed fetch per postId per soft-TTL window; TikTok's own
  per-domain player limits are documented and benign at this scale.

## Consequences

- The hub's depth = the curated list (honest v1 universe); feed depth awaits an
  operator-gated pool (Data API v2 app or an Apify actor through the broker).
- If TikTok walls an egress, oEmbed degrades to last-good → honest cards; the
  embed lane keeps working (viewer-side).
- The seams mirror netflix/* exactly — any future source follows the same shape.

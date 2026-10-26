import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

/**
 * P51-AUDIT (report §3.5 S1) — the first sitemap this app has had. The
 * Netflix per-title pages are the SEO-valuable long tail (real titles,
 * synopses, art via generateMetadata), so they ride the Prisma mirror —
 * the search index the Top 10 pools feed on every refresh. The mirror is
 * bounded (8 pools × 10, deduped — hundreds of rows), so enumerating it is
 * cheap; a DB outage degrades to the static surfaces honestly.
 */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://webflix-2-0-one.vercel.app";
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/netflix`, changeFrequency: "daily", priority: 0.9 },
    // P58 — the TikTok hub rides the static surfaces (the curated shelf;
    // per-post pages are not SEO-valuable until the universe grows).
    { url: `${base}/tiktok`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/help`, changeFrequency: "monthly", priority: 0.3 },
  ];
  try {
    const titles = await db.netflixTitle.findMany({
      select: { netflixId: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return [
      ...staticRoutes,
      ...titles.map((t) => ({
        url: `${base}/netflix/t/${t.netflixId}`,
        lastModified: t.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    ];
  } catch {
    // the mirror is down — the static surfaces stay discoverable
    return staticRoutes;
  }
}

import type { Metadata } from "next";
import View from "./view";
import { getNetflixTitlePage } from "@/lib/netflix/catalog";

export const revalidate = 3600;

/**
 * P42 — the Netflix title page (ISR shell; the client view resolves the id).
 *
 * P51-AUDIT (report §3.5 S1): these per-title URLs are the only SEO-valuable
 * surface in the Netflix hub, and they used to ship ONE boilerplate title to
 * every crawler while the view rendered client-only. The server can answer
 * from the same composition layer the API rides (pool caches → mirror) —
 * so `generateMetadata` carries the real title/synopsis/art, honestly
 * degraded to the generic shape when the catalog layer can't answer.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const netflixId = Number(id);
  if (!Number.isInteger(netflixId) || netflixId <= 0) {
    return { title: { absolute: "Netflix title — WebFlix" } };
  }
  try {
    const page = await getNetflixTitlePage(netflixId, null);
    if (!page) return { title: { absolute: "Netflix title — WebFlix" } };
    const t = page.title;
    const description =
      t.synopsis ||
      `${t.kind === "series" ? "Series" : "Film"} on Netflix${t.releaseYear ? ` (${t.releaseYear})` : ""}`;
    const images = t.backdropUrl || t.posterUrl ? [t.backdropUrl ?? t.posterUrl!] : undefined;
    return {
      title: { absolute: `${t.title}${t.releaseYear ? ` (${t.releaseYear})` : ""} — Netflix — WebFlix` },
      description,
      alternates: { canonical: `/netflix/t/${t.netflixId}` },
      openGraph: {
        title: t.title,
        description,
        images,
        type: "video.other",
      },
    };
  } catch {
    return { title: { absolute: "Netflix title — WebFlix" } };
  }
}

export default function Page() {
  return <View />;
}

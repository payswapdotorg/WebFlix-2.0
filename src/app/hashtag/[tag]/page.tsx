import type { Metadata } from "next";
import View from "./view";

export const revalidate = 3600;

/**
 * REA-1 G17 — /hashtag/[tag]: youtube.com's dedicated hashtag browse
 * surface (measured live 2026-10-17 — the header "#tag" + "N videos • M
 * channels" meta + a video grid + infinite scroll). ISR shell like the
 * explore-category family: the chrome is static, every datum client-fetched
 * from the dynamic /api/hashtag/[tag] route (the FEhashtag browse read).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const clean = decodeURIComponent(tag).replace(/^#/, "");
  return { title: clean ? `#${clean}` : "Hashtag" };
}

export default async function Page({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const clean = decodeURIComponent(tag).replace(/^#/, "");
  return <View tag={clean} />;
}

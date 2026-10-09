import { notFound } from "next/navigation";
import type { Metadata } from "next";
import View from "./view";
import { isExploreCategory } from "@/lib/youtube/explore-categories";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  return { title: isExploreCategory(key) ? key : "Explore" };
}

/**
 * WFX2-P19-EXPL — ISR shell (the explore/live pattern): the page chrome is
 * static and revalidated hourly; every datum stays client-fetched from the
 * dynamic /api/explore/category route (force-dynamic stays there by law).
 * Unknown keys (and "Live", which keeps its own /explore/live surface)
 * answer the honest 404 — never a fabricated category.
 */
export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isExploreCategory(key)) notFound();
  return <View category={key} />;
}

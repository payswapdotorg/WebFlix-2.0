import { WatchPage } from "@/components/watch/watch-page";
import { parseTimestampParam } from "@/lib/watch/share";

/**
 * WFX2-W watch page — /watch/[id] (+ optional ?t= start timestamp, the
 * share-link behavior: the copied link seeks on load).
 */
export default async function WatchRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tRaw = typeof sp.t === "string" ? sp.t : null;
  const t = parseTimestampParam(tRaw);
  // key → fresh mount per video (client state resets naturally)
  return <WatchPage key={id} videoId={id} startAt={t} />;
}

import { Suspense } from "react";
import { HomeFeed } from "@/components/home/home-feed";
import { Skeleton } from "@/components/ui/skeleton";

/** WFX2-C-W — ISR: the home shell (sidebar + category chips) revalidates
 * hourly; the feed data itself stays client-fetched from /api/home. */
export const revalidate = 3600;

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 sm:p-6" aria-busy="true">
          <Skeleton className="h-10 w-2/3 rounded-xl" />
        </div>
      }
    >
      <HomeFeed />
    </Suspense>
  );
}

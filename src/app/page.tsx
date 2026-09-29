import { Suspense } from "react";
import { HomeFeed } from "@/components/home/home-feed";
import { Skeleton } from "@/components/ui/skeleton";

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

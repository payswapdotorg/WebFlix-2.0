import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Gray verified check (YouTube-style). */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <BadgeCheck
      className={cn("size-3.5 fill-muted-foreground/40 text-foreground", className)}
      aria-label="Verified"
      role="img"
    />
  );
}

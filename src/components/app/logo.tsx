import { cn } from "@/lib/utils";

/** WebFlix logo — red play mark + wordmark (matches the reference). */
export function WebFlixLogo({ className, showWord = true }: { className?: string; showWord?: boolean }) {
  return (
    <span className={cn("flex select-none items-center gap-1", className)} aria-label="WebFlix Home">
      <svg
        viewBox="0 0 28 20"
        className="h-[20px] w-[28px] shrink-0"
        role="img"
        aria-hidden="true"
      >
        <rect x="0.5" y="0.5" width="27" height="19" rx="5" fill="#FF0000" />
        <path d="M11 6.2 11 13.8 17.5 10Z" fill="#fff" />
      </svg>
      {showWord && (
        <span className="text-lg font-bold tracking-tight text-foreground">WebFlix</span>
      )}
    </span>
  );
}

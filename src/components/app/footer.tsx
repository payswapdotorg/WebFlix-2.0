import { ZTubeLogo } from "./logo";

const FOOTER_LINKS = [
  "About",
  "Press",
  "Copyright",
  "Contact us",
  "Creators",
  "Advertise",
  "Developers",
] as const;

const FOOTER_LINKS_2 = [
  "Terms",
  "Privacy",
  "Policy & Safety",
] as const;

/** Site footer — sticks to the bottom of the scroll container (footer law). */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-muted-foreground sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <ZTubeLogo showWord={false} className="translate-y-[2px]" />
        <span className="font-medium text-foreground/80">ZTube</span>
        <span className="text-muted-foreground/80">— a YouTube-clone interface by WebFlix 2.0</span>
      </div>
      <nav aria-label="Footer" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {[...FOOTER_LINKS, ...FOOTER_LINKS_2].map((label) => (
          <span key={label} className="cursor-default hover:text-foreground" title={`${label} — static footer (Wave 4: WFX2-P)`}>
            {label}
          </span>
        ))}
      </nav>
      <p className="mt-3 text-xs text-muted-foreground/70">
        © 2026 WebFlix 2.0 · demo data from SQLite · interface baseline: ZTube
      </p>
    </footer>
  );
}

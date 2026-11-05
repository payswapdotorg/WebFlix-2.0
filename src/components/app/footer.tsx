import Link from "next/link";
import { WebFlixLogo } from "./logo";

/**
 * P94-c4 (the gap report's G12) — the footer links are REAL anchors now:
 * every label routes to the in-app surface that honestly serves it (the
 * production walk found the whole footer was inert plain text — the only
 * place legal/about links would live). Labels without a dedicated surface
 * route to /help (the catch-all FAQ) rather than pretending one exists.
 */
const FOOTER_LINKS: { label: string; href: string }[] = [
  { label: "About", href: "/help" },
  { label: "Press", href: "/feedback" },
  { label: "Copyright", href: "/help" },
  { label: "Contact us", href: "/feedback" },
  { label: "Creators", href: "/studio" },
  { label: "Advertise", href: "/premium" },
  { label: "Developers", href: "/help" },
];

const FOOTER_LINKS_2: { label: string; href: string }[] = [
  { label: "Terms", href: "/help" },
  { label: "Privacy", href: "/help" },
  { label: "Policy & Safety", href: "/help" },
];

/** Site footer — sticks to the bottom of the scroll container (footer law). */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-muted-foreground sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <WebFlixLogo showWord={false} className="translate-y-[2px]" />
        <span className="font-medium text-foreground/80">WebFlix</span>
        <span className="text-muted-foreground/80">— a YouTube-clone interface by WebFlix 2.0</span>
      </div>
      <nav aria-label="Footer" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {[...FOOTER_LINKS, ...FOOTER_LINKS_2].map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            className="transition-colors hover:text-foreground hover:underline underline-offset-2"
          >
            {label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-xs text-muted-foreground/70">
        © 2026 WebFlix 2.0 · live data from youtube.com · interface baseline: WebFlix
      </p>
    </footer>
  );
}

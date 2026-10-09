"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Ban,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  GraduationCap,
  MonitorPlay,
  Music,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WFX2-P20 — the WebFlix Premium surface at youtube.com/premium's full
 * structural depth:
 *
 *   1. Hero band — headline + subline + CTA per YouTube's hero layout. The
 *      honest CTA links the real product on youtube.com (labeled, never a
 *      WebFlix checkout).
 *   2. Plans comparison — YouTube's real three plans (Individual / Family /
 *      Student) in the real plan-card structure: plan name, who-it's-for
 *      line, price line, perk list, CTA. The prices are YouTube's listed US
 *      rates, labeled as such; WebFlix sells none of them.
 *   3. Benefits rows — the P5-SS honest benefit cards restyled to
 *      YouTube's benefit-row layout (icon + title + copy + ON YOUTUBE.COM).
 *   4. FAQ accordion — YouTube's real FAQ items (What is Premium / How do
 *      downloads work / cancel anytime) with honest YouTube-only answers.
 *   5. Footer links row — Terms · Privacy, like YouTube's footer row,
 *      pointing at YouTube's real documents (WebFlix has no purchase
 *      terms — there is nothing to buy).
 *
 * Honest-absence doctrine (unchanged from P5-SS, deepened structurally):
 * WebFlix has no paid tier, nothing is gated, and no subscribe/checkout
 * affordance exists anywhere on this page. The real Premium product lives
 * at youtube.com/premium.
 */

/** YouTube's real Premium plans, as listed on youtube.com/premium (US). */
const PLANS = [
  {
    slug: "individual",
    name: "Individual",
    icon: User,
    forLine: "One person, one membership",
    price: "$15.99/month",
    perks: [
      "Ad-free videos",
      "Background play",
      "Downloads",
      "YouTube Music Premium included",
    ],
  },
  {
    slug: "family",
    name: "Family",
    icon: Users,
    forLine: "You and up to 5 family members (ages 13+) in your household",
    price: "$26.99/month",
    perks: [
      "Everything in Individual",
      "Up to 5 household members (ages 13+)",
      "Each member gets their own membership",
    ],
  },
  {
    slug: "student",
    name: "Student",
    icon: GraduationCap,
    forLine: "Eligible students only — a discounted rate, verified yearly",
    price: "$8.99/month",
    perks: [
      "Everything in Individual",
      "Eligible students only",
      "Annual verification required",
    ],
  },
] as const;

/** The P5-SS honest benefit cards, restyled to YouTube's benefit-row layout. */
const BENEFITS = [
  {
    icon: Ban,
    title: "Ad-free videos",
    body: "A YouTube Premium benefit on youtube.com. WebFlix has no paid tier, so there is no ad-free upgrade to buy here — nothing on WebFlix is for sale.",
  },
  {
    icon: MonitorPlay,
    title: "Background play",
    body: "A YouTube Premium benefit on youtube.com. Not a WebFlix product — nothing on WebFlix is for sale.",
  },
  {
    icon: Download,
    title: "Downloads",
    body: "A YouTube Premium benefit on youtube.com for saving videos offline. WebFlix doesn't sell it and doesn't gate anything behind it.",
  },
  {
    icon: Music,
    title: "YouTube Music",
    body: "Included with YouTube Premium on youtube.com. WebFlix has no music offering.",
  },
] as const;

/** YouTube's real FAQ items, answered honestly (YouTube-only capability). */
const FAQ_ITEMS: { question: string; answer: ReactNode }[] = [
  {
    question: "What is YouTube Premium?",
    answer: (
      <>
        YouTube Premium is YouTube's paid membership — ad-free videos, background play,
        downloads, and YouTube Music Premium. It is YouTube's product: read about it and
        subscribe on youtube.com/premium. WebFlix has no paid tier — everything on WebFlix
        is free, and nothing is gated behind a membership.
      </>
    ),
  },
  {
    question: "How do downloads work?",
    answer: (
      <>
        Downloads are a YouTube Premium feature on youtube.com: members save videos
        offline inside YouTube's own apps. WebFlix has no download offering and no
        download to sell — watching on WebFlix streams from YouTube like it always has.
      </>
    ),
  },
  {
    question: "Can I cancel my membership anytime?",
    answer: (
      <>
        On YouTube, yes — YouTube Premium memberships can be cancelled anytime from
        YouTube's paid-membership settings (youtube.com/paid_memberships). WebFlix has
        no paid tier, so there is no membership to cancel and nothing to buy here.
      </>
    ),
  },
];

const FOOTER_LINKS = [
  { label: "Terms", href: "https://www.youtube.com/t/terms" },
  { label: "Privacy", href: "https://www.youtube.com/t/privacy" },
] as const;

export function PremiumView() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      {/* 1 — the hero band (YouTube's hero layout, honest CTA) */}
      <header
        data-premium-banner
        className="rounded-2xl border border-border bg-secondary/30 p-8 text-center"
      >
        <h1 className="text-3xl font-bold">WebFlix Premium</h1>
        <p className="mt-3 text-lg font-medium">
          WebFlix has no paid tier — everything here is free.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          There is no subscription to buy and nothing is gated. This page exists because the
          sidebar's WebFlix Premium entry points here, and it mirrors the Premium page layout
          you'd see on youtube.com — with WebFlix's honest version of it.
        </p>
        <span className="mt-5 inline-flex items-center rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">
          Nothing to buy — everything on WebFlix is free
        </span>
        <div className="mt-5">
          <a
            data-premium-cta
            href="https://www.youtube.com/premium"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-yt-red px-6 py-2 text-sm font-medium text-white transition hover:bg-yt-red/90"
          >
            YouTube Premium on youtube.com
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </header>

      {/* 2 — the plans comparison (YouTube's real plans, honest-absence CTAs) */}
      <section data-premium-plans className="mt-10" aria-label="YouTube Premium plans">
        <h2 className="text-xl font-bold">Plans from YouTube</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          YouTube Premium's real plans, in the plan-card structure you'd see on
          youtube.com/premium — prices are YouTube's listed US rates, and regional pricing
          varies. WebFlix sells none of these: every plan's purchase lives on youtube.com.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const PlanIcon = plan.icon;
            return (
              <article
                key={plan.slug}
                data-premium-plan={plan.slug}
                className="flex flex-col rounded-xl border border-border p-5"
              >
                <div className="flex items-center gap-2">
                  <PlanIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold">{plan.name}</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{plan.forLine}</p>
                <p className="mt-3 text-2xl font-bold">{plan.price}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  US rate as listed on youtube.com/premium — your region's price shows there
                </p>
                <ul className="mt-4 flex flex-col gap-2">
                  {plan.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-sm">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="https://www.youtube.com/premium"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Get the ${plan.name} plan on youtube.com (opens in a new tab)`}
                  className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                >
                  on youtube.com
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              </article>
            );
          })}
        </div>
      </section>

      {/* 3 — the benefits rows (the P5-SS cards, YouTube's benefit-row layout) */}
      <section data-premium-benefits className="mt-10" aria-label="YouTube Premium benefits">
        <h2 className="text-xl font-bold">The benefits (and who actually sells them)</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The perks below are YouTube Premium's benefits. Each one is labeled ON YOUTUBE.COM —
          they come with YouTube's membership, not with anything WebFlix could sell you.
        </p>
        <ul className="mt-6 flex flex-col divide-y divide-border rounded-xl border border-border">
          {BENEFITS.map((benefit) => {
            const BenefitIcon = benefit.icon;
            return (
              <li
                key={benefit.title}
                data-premium-benefit={benefit.title.toLowerCase().replace(/[^a-z]+/g, "-")}
                className="flex items-start gap-4 p-5"
              >
                <BenefitIcon
                  aria-hidden="true"
                  className="mt-0.5 size-6 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">{benefit.title}</h3>
                    <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[10px] tracking-wide text-muted-foreground">
                      ON YOUTUBE.COM
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {benefit.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 4 — the FAQ accordion (YouTube's real items, honest answers) */}
      <section data-premium-faq className="mt-10" aria-label="Frequently asked questions">
        <h2 className="text-xl font-bold">Frequently asked questions</h2>
        <div className="mt-6 flex flex-col divide-y divide-border rounded-xl border border-border">
          {FAQ_ITEMS.map((item, index) => {
            const open = openFaq === index;
            return (
              <div key={item.question} data-premium-faq-item={index}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`premium-faq-answer-${index}`}
                  onClick={() => setOpenFaq(open ? null : index)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left"
                >
                  <span className="text-base font-medium">{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>
                <div
                  id={`premium-faq-answer-${index}`}
                  hidden={!open}
                  className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground"
                >
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5 — the footer links row (Terms · Privacy, like YouTube's) */}
      <footer
        data-premium-footer
        className="mt-10 rounded-xl border border-border p-5 text-sm text-muted-foreground"
      >
        <nav aria-label="Premium page links" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:text-foreground hover:underline"
            >
              {link.label} on youtube.com
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ))}
          <span aria-hidden="true">·</span>
          <Link href="/help" className="font-medium hover:text-foreground hover:underline">
            Help
          </Link>
        </nav>
        <p className="mt-3 leading-relaxed">
          The purchase terms and privacy policy above are YouTube's real documents — a YouTube
          Premium membership is bought from and billed by YouTube. WebFlix has no paid tier, so
          there are no WebFlix purchase terms: nothing to buy, nothing to cancel.
        </p>
        <p className="mt-3">
          Questions about what WebFlix actually has?{" "}
          <Link href="/help" className="text-yt-red hover:underline">
            See the Help page
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}

export default PremiumView;

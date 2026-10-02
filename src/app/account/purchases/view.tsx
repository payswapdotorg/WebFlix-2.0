"use client";

/**
 * WFX2-P5-YA — Purchases & memberships: the honest-degradation page
 * (youtube.com's menu item → the truth). WebFlix processes no purchases or
 * memberships today, so there is no read seam — the page says so instead of
 * fabricating a list or a total. When real transactions exist, they render
 * in the slot below.
 */
import Link from "next/link";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

export default function PurchasesView() {
  return (
    <PersonalSurfaceGate surface="account" redirect="/account/purchases">
      <PurchasesContent />
    </PersonalSurfaceGate>
  );
}

function PurchasesContent() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" className="w-fit gap-2 rounded-full px-4">
        <Link href="/you">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShoppingBag className="size-7 text-yt-red" aria-hidden="true" /> Purchases &amp;
          memberships
        </h1>
      </div>

      {/* data slot: real purchase/membership records render here when a seam exists */}
      <section
        aria-label="Purchases and memberships status"
        className="rounded-xl border border-border p-4 sm:p-6"
        data-testid="purchases-honest-state"
      >
        <h2 className="text-base font-semibold">Nothing to show yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Purchases and memberships aren&apos;t available on WebFlix yet — no transactions
          exist to show. When WebFlix starts processing them, your real purchases and
          memberships will appear here (never a fabricated list).
        </p>
      </section>
    </main>
  );
}

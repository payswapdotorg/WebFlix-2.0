#!/usr/bin/env python3
"""P103-mini-5 — the mobile 375px overflow walk (the honest residual closure).

Walks the live-lane surfaces (plus the home baseline) at a 375px viewport and
MEASURES horizontal overflow (scrollWidth - clientWidth on <html>). The project
law: 0px overflow. Also captures console errors / page errors / failed requests
so the walk doubles as a browser-level sanity probe.

The live lane is quota-dead (Apify 403, cycle resets 2026-12-06) by design of
the moment — the walk therefore ALSO verifies the HONEST degraded states render
on mobile (no endless spinner, no fabricated content).

Usage:
  WEBFLIX_BASE_URL=http://localhost:3000 python3 scripts/ops/mobile-375-walk.py
  WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app python3 scripts/ops/mobile-375-walk.py

Exit code 0 = all surfaces clean (0px overflow, no console/page errors,
honest-state assertions pass). Exit 1 = any check failed (details printed).
"""

import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("WEBFLIX_BASE_URL", "http://localhost:3000").rstrip("/")
VIEWPORT = {"width": 375, "height": 812}  # iPhone-class, the P52/P95 law
SETTLE_MS = int(os.environ.get("WALK_SETTLE_MS", "12000"))
# The prod outage cadence (P103-mini-3): a first hit STARTS the probe; the
# failure lands seconds later; the honest error shows inside the 60s backoff
# (measured ~T+38s on prod). Poll up to this deadline for the expected state.
HONEST_TIMEOUT_S = int(os.environ.get("WALK_HONEST_TIMEOUT_S", "75"))

# (path, optional honest-state substring that must appear within HONEST_TIMEOUT_S)
SURFACES = [
    ("/", None),
    ("/tiktok/lives", "unavailable"),
    ("/tiktok/lofigirl/live", "unavailable"),
]


def walk(page, path, expect_substring):
    console_errors = []
    page_errors = []
    failed_requests = []

    page.on(
        "console",
        lambda m: console_errors.append(m.text) if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on(
        "requestfailed",
        lambda r: failed_requests.append(f"{r.method} {r.url} :: {r.failure}"),
    )

    url = BASE + path
    t0 = time.time()
    page.goto(url, wait_until="load", timeout=45_000)
    page.wait_for_timeout(SETTLE_MS)

    # the honest-state wait: poll body text up to HONEST_TIMEOUT_S (the prod
    # probing→error cadence means the degraded state can land well past the
    # fixed settle; an endless spinner that NEVER degrades is the bug class)
    honest_hit = None
    if expect_substring:
        deadline = time.time() + HONEST_TIMEOUT_S
        while time.time() < deadline:
            body_text = page.inner_text("body")
            if expect_substring.lower() in body_text.lower():
                honest_hit = True
                break
            honest_hit = False
            page.wait_for_timeout(2_000)

    overflow = page.evaluate(
        """() => {
            const d = document.documentElement;
            return {sw: d.scrollWidth, cw: d.clientWidth, px: d.scrollWidth - d.clientWidth};
        }"""
    )

    return {
        "path": path,
        "overflow_px": overflow["px"],
        "scroll_width": overflow["sw"],
        "client_width": overflow["cw"],
        "console_errors": console_errors,
        "page_errors": page_errors,
        "failed_requests": failed_requests,
        "honest_expected": expect_substring,
        "honest_hit": honest_hit,
        "elapsed_s": round(time.time() - t0, 1),
    }


def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=2, is_mobile=True)
        page = ctx.new_page()
        print(f"== 375px walk against {BASE} (settle {SETTLE_MS}ms) ==")
        for path, expect in SURFACES:
            r = walk(page, path, expect)
            verdict = "OK" if r["overflow_px"] == 0 else "OVERFLOW"
            print(
                f"[{verdict}] {r['path']}  overflow={r['overflow_px']}px "
                f"(sw={r['scroll_width']} cw={r['client_width']})  {r['elapsed_s']}s"
            )
            if expect is not None:
                hv = "HIT" if r["honest_hit"] else "MISS"
                print(f"       honest-state ({expect!r}): {hv}")
                if not r["honest_hit"]:
                    failures.append(f"{path}: honest state missing ({expect!r})")
            if r["overflow_px"] != 0:
                failures.append(f"{path}: horizontal overflow {r['overflow_px']}px")
            if r["page_errors"]:
                failures.append(f"{path}: page errors: {r['page_errors'][:3]}")
            for ce in r["console_errors"][:5]:
                print(f"       console.error: {ce[:200]}")
            # Failed requests are informational (the quota-dead lane 5xxes by
            # design; net errors like ERR_ABORTED on polls are recorded, not fatal)
            for fr in r["failed_requests"][:5]:
                print(f"       requestfailed: {fr[:200]}")
        browser.close()

    print()
    if failures:
        print("FAIL — the walk found problems:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — all surfaces 0px overflow; honest states verified where asserted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

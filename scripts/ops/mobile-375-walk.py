#!/usr/bin/env python3
"""The WebFlix browser walk — the honest-degrade instrument (P103-mini-5/6).

Walks the live-lane surfaces (plus the home baseline) at a configurable
viewport (default 375x812, the iPhone-class mobile law) and MEASURES:

  1. HORIZONTAL OVERFLOW — scrollWidth - clientWidth on <html>; the law: 0px.
  2. HONEST DEGRADE STATES — the live surfaces must reach their real error
     copy (an endless spinner that never degrades is the caught bug class).
     The prod outage cadence (P103-mini-3: a first hit STARTS the probe, the
     failure lands seconds later, ~T+38s measured on prod) means the walk
     POLLS body text up to WALK_HONEST_TIMEOUT_S instead of sampling at a
     fixed settle (a fixed settle false-MISSed the healthy degrade once).
  3. THE FAILURE LAW (P103-mini-6) — responses are CLASSIFIED, mechanically:
       - external hosts (i.ytimg.com ...)  -> noise (upstream reality)
       - origin 404                        -> FAIL (broken route class)
       - origin 5xx                        -> FAIL (broken backend class;
         the /api/me unseeded-db 500 was caught by EYE in P103-mini-5 —
         this law is that catch made mechanical)
       - origin 5xx on /api/tiktok/live*   -> noise (the DESIGNED honest
         degrade lane: 502/503 quota-death answers; their honesty is
         asserted by the honest-state law above, not double-punished)
       - origin 400/401/403                -> noise (designed validation and
         auth contracts: the G20 garbage-handle 400, guest-gate 401s)
     Page errors (uncaught exceptions) always FAIL.

Usage:
  python3 scripts/ops/mobile-375-walk.py                       # local :3000, 375px
  WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app python3 scripts/ops/mobile-375-walk.py
  WALK_VIEWPORT=1440x900 python3 scripts/ops/mobile-375-walk.py   # the desktop lane
  python3 scripts/ops/mobile-375-walk.py --selftest            # the classifier pins

Exit code 0 = all surfaces clean. Exit 1 = any law broken (details printed).
"""

import os
import sys
import time
from urllib.parse import urlparse

# playwright is imported lazily so --selftest runs anywhere
BASE = os.environ.get("WEBFLIX_BASE_URL", "http://localhost:3000").rstrip("/")
SETTLE_MS = int(os.environ.get("WALK_SETTLE_MS", "12000"))
HONEST_TIMEOUT_S = int(os.environ.get("WALK_HONEST_TIMEOUT_S", "75"))


def parse_viewport(raw):
    """'WxH' -> dict; absent/garbage -> the 375x812 mobile law."""
    raw = (raw or "").strip().lower()
    try:
        w, h = raw.split("x")
        w, h = int(w), int(h)
        if w >= 200 and h >= 200:
            return {"width": w, "height": h}
    except (ValueError, AttributeError):
        pass
    return {"width": 375, "height": 812}


VIEWPORT = parse_viewport(os.environ.get("WALK_VIEWPORT", ""))

# (path, optional honest-state substring that must appear within HONEST_TIMEOUT_S)
SURFACES = [
    ("/", None),
    ("/search?q=lofigirl", None),  # the G6 surface: search rows ride mapVideoRenderer;
                                   # a bare /channel anchor would prefetch -> origin 404 -> FAIL
    ("/netflix", None),  # the WFX2-COVERAGE-1 surface: the main Netflix-mode browse
                         # surface was probe-200-only before; now walked at DOM level
                         # (overflow + the failure law) like every other standing surface
    ("/tiktok", None),  # the WFX2-COVERAGE-2 surface: the TikTok tab hub (the TL's
                        # critical path) was probe-200-only before
    ("/signin", None),  # the WFX2-COVERAGE-2 surface: the auth gate every guest-gated
                        # flow lands on (its redirect-traffic was seen in live-lane walks)
    ("/upload", None),  # the WFX2-COVERAGE-3 surface: the creator upload lane (the
                        # most-wiped surface's UI). Any guest gate is FINE: the walk
                        # records final_url, so a redirect to /signin is data, not mud
    ("/tiktok/lives", "unavailable"),
    ("/tiktok/lofigirl/live", "unavailable"),
]

# the DESIGNED honest-degrade lane (502/503 quota-death answers ride here by
# design; their honesty is the honest-state law's job — never double-punished)
LIVE_LANE_PREFIX = "/api/tiktok/live"


def classify_status(status, url, base=BASE):
    """'fail' | 'noise' | None — the P103-mini-6 failure law, pure and pinnable."""
    if status is None or status < 400:
        return None
    try:
        u_host = urlparse(url).netloc
        b_host = urlparse(base).netloc
    except (ValueError, AttributeError):
        return "noise"
    if u_host != b_host:
        return "noise"  # external CDNs (i.ytimg.com variant gaps et al.)
    if status == 404:
        path = urlparse(url).path
        # the WFX2-COVERAGE-4 carve-out (the live-lane-5xx precedent): the
        # DEFAULT transcript lane reads the seeded DB store BY DESIGN
        # (transcript/route.ts's own doc: "the seeded DB store, unchanged"),
        # so a remotely-sourced video (live youtube `next` lane) honestly
        # 404s {"error":"Video not found"} — the watch-page client swallows
        # it (.catch resets the fetch ref; no crash, no spinner) and renders
        # without cues. Designed absence, not a broken route. TRADEOFF
        # (documented): a truly deleted transcript route would 404 the same
        # shape and ride this carve-out too — accepted, because route-class
        # breakage stays caught by every other surface's law.
        if path.startswith("/api/videos/") and path.endswith("/transcript"):
            return "noise"  # the designed transcript-absence answer class
        return "fail"  # an origin route answered route-not-found
    if status >= 500:
        path = urlparse(url).path
        if path.startswith(LIVE_LANE_PREFIX):
            return "noise"  # the designed quota-death answer class
        return "fail"  # an origin 5xx outside the designed degrade lane
    return "noise"  # 400/401/403: designed validation/auth contracts


def selftest():
    """The classifier pins — the /api/me-500 class must FAIL, mechanically."""
    base = "https://webflix-2-0-tepa.vercel.app"
    cases = [
        # (description, expected, status, url)
        ("the P103-mini-5 catch: origin /api/me 500 FAILS",
         "fail", 500, base + "/api/me"),
        ("origin 404 FAILS",
         "fail", 404, base + "/api/does-not-exist"),
        ("the WFX2-COVERAGE-4 catch: designed transcript-absence 404 is noise",
         "noise", 404, base + "/api/videos/okH-kaRjuAQ/transcript"),
        ("a non-transcript video-API 404 still FAILS",
         "fail", 404, base + "/api/videos/okH-kaRjuAQ/related"),
        ("designed live-lane 503 is noise",
         "noise", 503, base + "/api/tiktok/live?handle=lofigirl"),
        ("designed live-lane board 502 is noise",
         "noise", 502, base + "/api/tiktok/live/board"),
        ("designed live-chat 5xx is noise (same lane family)",
         "noise", 503, base + "/api/tiktok/live/chat/some-room"),
        ("external ytimg 404 is noise",
         "noise", 404, "https://i.ytimg.com/vi/_Wx6fnTK2us/oardefault.jpg"),
        ("designed guest 401 is noise",
         "noise", 401, base + "/api/connection/tiktok"),
        ("designed G20 garbage 400 is noise",
         "noise", 400, base + "/api/tiktok/live?handle=%40%40%23%24bad!!"),
        ("healthy 200 is None (never recorded)",
         None, 200, base + "/api/me"),
        ("origin 200 on the live lane is None too",
         None, 200, base + "/api/tiktok/live?handle=lofigirl"),
        ("a 302 redirect is None",
         None, 302, base + "/signin"),
    ]
    bad = []
    for desc, expected, status, url in cases:
        got = classify_status(status, url, base=base)
        marker = "ok" if got == expected else "MISMATCH"
        print(f"  [{marker}] {desc}: got={got}")
        if got != expected:
            bad.append(desc)
    # the viewport law
    vp_bad = []
    for raw, want in [
        ("", {"width": 375, "height": 812}),
        ("garbage", {"width": 375, "height": 812}),
        ("1440x900", {"width": 1440, "height": 900}),
        ("100x100", {"width": 375, "height": 812}),  # sub-200 floors to the law
        ("800x600", {"width": 800, "height": 600}),
    ]:
        got = parse_viewport(raw)
        marker = "ok" if got == want else "MISMATCH"
        print(f"  [{marker}] viewport {raw!r} -> {got}")
        if got != want:
            vp_bad.append(raw)
    if bad or vp_bad:
        print(f"SELFTEST FAIL ({len(bad)} classifier, {len(vp_bad)} viewport)")
        return 1
    print("SELFTEST PASS — the failure law holds on every pin.")
    return 0


def walk(page, path, expect_substring):
    console_errors = []
    page_errors = []
    failed_requests = []
    http_failures = []  # classified 'fail' — the mechanical law's output
    http_noise = []  # classified 'noise' — recorded, never fatal

    page.on(
        "console",
        lambda m: console_errors.append(m.text) if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on(
        "requestfailed",
        lambda r: failed_requests.append(f"{r.method} {r.url} :: {r.failure}"),
    )
    page.on(
        "response",
        lambda r: (
            http_failures.append(f"{r.status} {r.url}")
            if classify_status(r.status, r.url) == "fail"
            else (http_noise.append(f"{r.status} {r.url}")
                  if classify_status(r.status, r.url) == "noise" else None)
        ),
    )

    url = BASE + path
    t0 = time.time()
    page.goto(url, wait_until="load", timeout=45_000)
    page.wait_for_timeout(SETTLE_MS)
    final_url = page.url  # the WFX2-COVERAGE-3 law: a redirect (e.g. /upload ->
    # /signin?redirect=...) is RECORDED, never silently measured as its target

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
        "final_url": final_url,
        "overflow_px": overflow["px"],
        "scroll_width": overflow["sw"],
        "client_width": overflow["cw"],
        "console_errors": console_errors,
        "page_errors": page_errors,
        "failed_requests": failed_requests,
        "http_failures": http_failures,
        "http_noise": http_noise,
        "honest_expected": expect_substring,
        "honest_hit": honest_hit,
        "elapsed_s": round(time.time() - t0, 1),
    }


def discover_first_watch_href(page):
    """The WFX2-COVERAGE-4 law: the user click path home -> first video link.
    Discovered DYNAMICALLY so the surface generalizes across stations (no
    hardcoded ids: local seed and prod data differ)."""
    hrefs = page.evaluate(
        """() => Array.from(document.querySelectorAll('a[href^="/watch/"]'))
            .map(a => a.getAttribute('href'))
            .filter(Boolean)"""
    )
    return hrefs[0] if hrefs else None


def main():
    if "--selftest" in sys.argv:
        return selftest()

    from playwright.sync_api import sync_playwright

    failures = []
    label = f"{VIEWPORT['width']}x{VIEWPORT['height']}"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        is_mobile = VIEWPORT["width"] < 800
        ctx = browser.new_context(
            viewport=VIEWPORT, device_scale_factor=2, is_mobile=is_mobile
        )
        page = ctx.new_page()
        print(f"== {label} walk against {BASE} (settle {SETTLE_MS}ms) ==")
        dynamic_surface = None
        for path, expect in SURFACES:
            r = walk(page, path, expect)
            if path == "/":
                # the click-path discovery rides the home walk's own settled page
                dynamic_surface = discover_first_watch_href(page)
            verdict = "OK" if r["overflow_px"] == 0 else "OVERFLOW"
            print(
                f"[{verdict}] {r['path']}  overflow={r['overflow_px']}px "
                f"(sw={r['scroll_width']} cw={r['client_width']})  {r['elapsed_s']}s"
            )
            if r["final_url"] != BASE + r["path"]:
                print(f"       redirected-to: {r['final_url']}")
            if expect is not None:
                hv = "HIT" if r["honest_hit"] else "MISS"
                print(f"       honest-state ({expect!r}): {hv}")
                if not r["honest_hit"]:
                    failures.append(f"{path}: honest state missing ({expect!r})")
            if r["overflow_px"] != 0:
                failures.append(f"{path}: horizontal overflow {r['overflow_px']}px")
            if r["page_errors"]:
                failures.append(f"{path}: page errors: {r['page_errors'][:3]}")
            for hf in r["http_failures"][:5]:
                print(f"       HTTP-LAW-FAIL: {hf[:200]}")
                failures.append(f"{path}: HTTP failure-law hit: {hf}")
            for ce in r["console_errors"][:5]:
                print(f"       console.error: {ce[:200]}")
            # noise + requestfailed are recorded, never fatal (the designed
            # quota-dead 503s, upstream CDN gaps, navigation-canceled aborts)
            for hn in r["http_noise"][:5]:
                print(f"       http-noise: {hn[:200]}")
            for fr in r["failed_requests"][:5]:
                print(f"       requestfailed: {fr[:200]}")

        if dynamic_surface:
            r = walk(page, dynamic_surface, None)
            verdict = "OK" if r["overflow_px"] == 0 else "OVERFLOW"
            print(
                f"[{verdict}] dynamic:home-first-watch -> {r['path']}  "
                f"overflow={r['overflow_px']}px "
                f"(sw={r['scroll_width']} cw={r['client_width']})  {r['elapsed_s']}s"
            )
            if r["final_url"] != BASE + r["path"]:
                print(f"       redirected-to: {r['final_url']}")
            if r["overflow_px"] != 0:
                failures.append(f"{r['path']}: horizontal overflow {r['overflow_px']}px")
            if r["page_errors"]:
                failures.append(f"{r['path']}: page errors: {r['page_errors'][:3]}")
            for hf in r["http_failures"][:5]:
                print(f"       HTTP-LAW-FAIL: {hf[:200]}")
                failures.append(f"{r['path']}: HTTP failure-law hit: {hf}")
            for ce in r["console_errors"][:5]:
                print(f"       console.error: {ce[:200]}")
            for hn in r["http_noise"][:5]:
                print(f"       http-noise: {hn[:200]}")
            for fr in r["failed_requests"][:5]:
                print(f"       requestfailed: {fr[:200]}")
        else:
            print("[SKIP] dynamic:home-first-watch — no /watch/ anchor found on home")
        browser.close()

    print()
    if failures:
        print("FAIL — the walk found problems:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — all surfaces 0px overflow at {label}; "
        "honest states verified where asserted; the failure law found nothing."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

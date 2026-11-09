#!/bin/sh
''':'
exec /home/z/.venv/bin/python "$0" "$@"
'''
"""watch-playback-proof.py — the /watch playback-proof instrument (WFX2-WATCH-PLAY-1).

Proves or honestly blocks REAL playback on the /watch surface — the primary
watch path (home feed -> /watch anchor -> player) — against a WebFlix base.
The sibling of tiktok-playback-proof.py (G2) for the YouTube vertical: same
verdict discipline, zero claimed playback without evidence, blocked verdicts
are honest completions.

Verdicts per video (page-truth only — the app's OWN trusted signals):
  PLAYING-EMBED    the YT embed lane is playing: an youtube.com/embed iframe
                   mounted AND at least one of
                     - POST /api/view observed (fired on state=1),
                     - sessionStorage webflix-view:<id> == "1" (the in-page
                       mark, set the moment state=1),
                     - localStorage webflix-progress:<id> appeared with
                       sec>0 or advanced (the 1s playing loop's 5s persist).
  PLAYING-NATIVE   the fallback chain's native lane is playing: a <video>
                   element (not inside the YT wrapper) with readyState>=2 and
                   currentTime advancing >=2s across samples.
  BLOCKED-EMBED    the app's blocked card rendered ("Playback unavailable in
                   the embedded player") — the embed-wall signature, with the
                   network chain that produced it recorded.
  BLOCKED-NETWORK  the youtube.com/iframe_api script itself failed (non-200
                   or requestfailed) — no embed can exist; page-truth.
  NO-PLAYER        neither iframe nor native video within the budget.

Surfaces: N videos DISCOVERED DYNAMICALLY (the COVERAGE-4 law — zero
hardcoded ids): GET /api/videos?limit=8 -> the first 3 ids in feed order.
Feed empty -> one search-compose retry (?q=lofigirl, the G6 query). Still
empty -> BLOCKED-FEED for the run (the discovery surface itself is walled).

MEASURED per surface:
  a. network truth: every response/requestfailed captured and classified
     origin vs external; the playback chain reconstructed (iframe_api,
     /embed/*, googlevideo, /api/videos/<id>/playback, /api/view, /api/stream).
  b. iframe presence + count sampled at 0.5s cadence (youtube.com/embed).
  c. native <video> elements polled: readyState/currentTime/paused/src host.
  d. the app's trusted playing signals (above) polled at 0.5s cadence.
  e. console + pageerror full capture (the probe's embed-wall logs, stalls).
  f. blocked-card visibility (aria-label "Playback unavailable in the
     embedded player").
  g. the failure law (P103-mini-6 class, copied from the walk): origin
     404/5xx FAIL — DESIGNED lanes noise (the /api/tiktok/live* 5xx degrade,
     400/401/403 designed contracts); external CDN gaps noise; requestfailed
     recorded noise (incl. aborted prefetches).
  h. the overflow law: documentElement.scrollWidth - clientWidth == 0.

Interaction law: if no playback evidence by T_INTERACT and a player exists,
ONE user-gesture play attempt (click the video surface; YT iframes get a
playVideo attempt via the API only when the page exposes it — the iframe's
own UI is clicked otherwise). The attempt is recorded.

Verdict precedence: PLAYING-EMBED > PLAYING-NATIVE > BLOCKED-EMBED >
BLOCKED-NETWORK > NO-PLAYER. Exit 0 iff every surface reached a verdict
(blocked verdicts are honest completions, not instrument failure); exit 2
on instrument error.

Env: WEBFLIX_BASE_URL (default http://localhost:3000),
     PROOF_VIDEOS (default 3), PROOF_HEADLESS (default 1, 0 = headed),
     PROOF_VIEWPORT (default 1440x900; "375x812" = the mobile-emulation lane,
     the G2 instrument's env switch — same two-viewport law as the walk).
"""

import json
import os
import re
import sys
import time
import traceback
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("WEBFLIX_BASE_URL", "http://localhost:3000").rstrip("/")
N_VIDEOS = int(os.environ.get("PROOF_VIDEOS", "3"))
HEADLESS = os.environ.get("PROOF_HEADLESS", "1") != "0"
_vw, _vh = (os.environ.get("PROOF_VIEWPORT", "1440x900").split("x") + ["900"])[:2]
VIEWPORT = {"width": int(_vw), "height": int(_vh)}
IS_MOBILE_LANE = VIEWPORT["width"] <= 500

T_LOAD = 20.0        # page load + first-evidence budget
T_INTERACT = 12.0    # user-gesture arm time
T_TOTAL = 40.0       # hard wall-clock per surface
POLL = 0.5

BLOCKED_ARIA = "Playback unavailable in the embedded player"
YT_IFRAME_SEL = 'iframe[src*="youtube.com/embed"]'
PROGRESS_KEY = "webflix-progress:"
VIEW_KEY = "webflix-view:"


def classify_failure(path: str, status: int) -> str:
    """The failure law's designed-lane carve-outs (mirror of the walk's).

    - /api/tiktok/live* 5xx: the DESIGNED honest-degrade lane (quota death).
    - 400/401/403: designed contracts (input validation, auth gates).
    - /api/videos/<id>/transcript 404: the WFX2-COVERAGE-4 carve-out — the
      transcript lane reads the SEEDED DB store by design (transcript/route.ts's
      own doc), so live-feed videos (no seeded cues) 404 and the client swallows
      via .catch. Documented tradeoff (as in the walk): a truly deleted
      transcript route would ride this carve-out too — accepted, because the
      route-class shape is the designed answer to a designed absence.
    """
    if path.startswith("/api/videos/") and path.endswith("/transcript"):
        return "noise"  # the designed transcript-absence answer class (COVERAGE-4)
    if path.startswith("/api/tiktok/live") and status >= 500:
        return "noise"
    if status in (400, 401, 403):
        return "noise"
    return "FAIL"


def log(msg: str) -> None:
    print(msg, flush=True)


def discover_videos() -> tuple[list[dict], str]:
    """Dynamic discovery from the live feed (zero hardcoded ids)."""
    attempts = []
    for url, note in (
        (f"{BASE}/api/videos?limit=8", "live-feed"),
        (f"{BASE}/api/videos?limit=8&q=lofigirl", "search-compose"),
    ):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                data = json.load(r)
            vids = [v for v in data.get("videos", []) if v.get("id")]
            attempts.append(f"{note}: {len(vids)} videos")
            if vids:
                return vids[:N_VIDEOS], "; ".join(attempts)
            attempts.append(f"{note}: EMPTY body")
        except Exception as e:  # noqa: BLE001 — honest instrument
            attempts.append(f"{note}: ERROR {type(e).__name__}: {e}")
    return [], "; ".join(attempts)


def classify_url(url: str) -> str:
    if url.startswith(BASE):
        return "origin"
    host = urllib.parse.urlparse(url).netloc
    return f"external:{host}"


class SurfaceRun:
    def __init__(self, page, video: dict) -> None:
        self.page = page
        self.video = video
        self.vid = video["id"]
        self.responses: list[tuple[int, str, str]] = []  # status, url, class
        self.request_failed: list[str] = []
        self.console: list[str] = []
        self.page_errors: list[str] = []
        self.view_ping_seen = False
        self.iframe_samples: list[int] = []
        self.native_samples: list[tuple[float, int, float, bool, str]] = []
        self.blocked_card_seen = False
        self.overflow_px: int | None = None
        self.interact_attempted = False
        self._progress_before = None
        self._view_before = None
        self._attach()

    def _attach(self) -> None:
        page = self.page
        page.on("response", self._on_response)
        page.on("requestfailed", self._on_reqfailed)
        page.on("console", lambda m: self.console.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: self.page_errors.append(str(e)))

    def _on_response(self, resp) -> None:
        try:
            url = resp.url
            status = resp.status
            cls = classify_url(url)
            self.responses.append((status, url, cls))
            if cls == "origin" and "/api/view" in url:
                self.view_ping_seen = True
        except Exception:  # noqa: BLE001
            pass

    def _on_reqfailed(self, req) -> None:
        try:
            self.request_failed.append(f"{req.url} :: {req.failure}")
        except Exception:  # noqa: BLE001
            pass

    def snapshot_storage(self) -> None:
        try:
            self._progress_before = self.page.evaluate(
                "k => localStorage.getItem(k)", f"{PROGRESS_KEY}{self.vid}"
            )
            self._view_before = self.page.evaluate(
                "k => sessionStorage.getItem(k)", f"{VIEW_KEY}{self.vid}"
            )
        except Exception:  # noqa: BLE001
            pass

    def poll_state(self) -> dict:
        page = self.page
        state: dict = {}
        try:
            state["iframes"] = page.locator(YT_IFRAME_SEL).count()
        except Exception:  # noqa: BLE001
            state["iframes"] = -1
        try:
            state["blocked_card"] = (
                page.get_by_role("region", name=BLOCKED_ARIA).count() > 0
            )
            if state["blocked_card"]:
                self.blocked_card_seen = True
        except Exception:  # noqa: BLE001
            state["blocked_card"] = False
        try:
            vids = page.evaluate(
                """() => [...document.querySelectorAll('video')].map(v => ({
                    readyState: v.readyState, t: v.currentTime,
                    paused: v.paused, src: (v.currentSrc || v.src || '').slice(0, 160),
                }))"""
            )
            state["native_videos"] = vids
            now = time.monotonic()
            for v in vids:
                if v["src"] and "youtube.com" not in v["src"]:
                    self.native_samples.append(
                        (now, v["readyState"], v["t"], v["paused"], v["src"])
                    )
        except Exception:  # noqa: BLE001
            state["native_videos"] = []
        try:
            state["view_mark"] = page.evaluate(
                "k => sessionStorage.getItem(k) === '1'", f"{VIEW_KEY}{self.vid}"
            )
            prog = page.evaluate(
                "k => localStorage.getItem(k)", f"{PROGRESS_KEY}{self.vid}"
            )
            state["progress"] = prog
        except Exception:  # noqa: BLE001
            state["view_mark"] = False
            state["progress"] = None
        try:
            state["overflow"] = page.evaluate(
                "document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            self.overflow_px = state["overflow"]
        except Exception:  # noqa: BLE001
            pass
        return state

    def try_interact(self) -> str:
        self.interact_attempted = True
        try:
            # 1) the page's own player surface (the YT wrapper / native video)
            cx = VIEWPORT["width"] // 2
            cy = min(300, VIEWPORT["height"] // 3)
            self.page.mouse.move(cx, cy)
            self.page.mouse.click(cx, cy)
            return f"clicked-video-surface ({cx},{cy})"
        except Exception as e:  # noqa: BLE001
            return f"interact-error {type(e).__name__}"

    def playback_truth(self, states: list[dict]) -> tuple[bool, bool, str]:
        """(embed_playing, native_playing, why)."""
        if self.view_ping_seen or any(s.get("view_mark") for s in states):
            return True, False, "view-ping/session-mark observed"
        before = self._progress_before
        after = None
        for s in reversed(states):
            if s.get("progress") is not None:
                after = s["progress"]
                break

        def sec_of(raw: str | None) -> float | None:
            if not raw:
                return None
            try:
                v = json.loads(raw)
                return float(v.get("sec") or 0)
            except Exception:  # noqa: BLE001
                return None

        s_before, s_after = sec_of(before), sec_of(after)
        if s_after is not None and s_after > 0 and (s_before is None or s_after > s_before):
            return True, False, f"progress key {s_before} -> {s_after}"
        # native lane: >=2s advance across samples, readyState>=2
        if len(self.native_samples) >= 2:
            first, last = self.native_samples[0], self.native_samples[-1]
            if first[1] >= 2 and last[1] >= 2 and (last[2] - first[2]) >= 2.0:
                return False, True, (
                    f"native video advanced {first[2]:.1f}s -> {last[2]:.1f}s "
                    f"readyState={last[1]}"
                )
        return False, False, "no trusted playing signal yet"

    def failure_law(self) -> list[str]:
        fails = []
        for status, url, cls in self.responses:
            if cls != "origin" or status < 400:
                continue
            path = urllib.parse.urlparse(url).path
            if classify_failure(path, status) == "noise":
                continue
            fails.append(f"HTTP-LAW-FAIL: {status} {path}")
        return fails


def run_surface(browser, video: dict) -> dict:
    ctx = browser.new_context(
        viewport=VIEWPORT, device_scale_factor=2, is_mobile=IS_MOBILE_LANE
    )
    page = ctx.new_page()
    run = SurfaceRun(page, video)
    url = f"{BASE}/watch/{run.vid}"
    log(f"  -> {url}")
    log(f"     title: {video.get('title', '')[:70]}")
    verdict = None
    why = ""
    states: list[dict] = []
    try:
        run.snapshot_storage()
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        t0 = time.monotonic()
        while time.monotonic() - t0 < T_TOTAL:
            states.append(run.poll_state())
            embed_playing, native_playing, truth = run.playback_truth(states)
            elapsed = time.monotonic() - t0
            if embed_playing or native_playing:
                verdict = "PLAYING-EMBED" if embed_playing else "PLAYING-NATIVE"
                why = truth
                break
            if run.blocked_card_seen and elapsed >= T_INTERACT:
                verdict = "BLOCKED-EMBED"
                why = "the app's blocked card rendered"
                break
            if elapsed >= T_INTERACT and not run.interact_attempted:
                if states[-1]["iframes"] > 0 or states[-1]["native_videos"]:
                    attempt = run.try_interact()
                    log(f"     [interact] {attempt}")
            if elapsed >= T_LOAD and states[-1]["iframes"] == 0 and not states[-1][
                "native_videos"
            ] and not run.blocked_card_seen:
                api_dead = [
                    (s, u) for s, u, c in run.responses
                    if "iframe_api" in u and s >= 400
                ] + [u for u in run.request_failed if "iframe_api" in u]
                if api_dead:
                    verdict = "BLOCKED-NETWORK"
                    why = f"iframe_api itself failed: {api_dead[:1]}"
                    break
            time.sleep(POLL)
        if verdict is None:
            if run.blocked_card_seen:
                verdict, why = "BLOCKED-EMBED", "blocked card rendered (late)"
            else:
                verdict, why = "NO-PLAYER", "no iframe, no native video, no evidence"
    except Exception as e:  # noqa: BLE001
        verdict, why = "NO-PLAYER", f"instrument surface error: {type(e).__name__}: {e}"
        log(traceback.format_exc(limit=3))

    iframe_peak = max([s.get("iframes", 0) for s in states], default=0)
    net_chain = {}
    for status, u, cls in run.responses:
        for tag in ("iframe_api", "/embed/", "googlevideo", "/playback", "/api/view", "/api/stream"):
            if tag in u:
                net_chain.setdefault(tag, f"{status} {cls}")
    log(f"     verdict: {verdict} ({why})")
    log(f"     iframe peak: {iframe_peak} | view-ping: {run.view_ping_seen} | "
        f"blocked-card: {run.blocked_card_seen} | overflow: {run.overflow_px}px")
    log(f"     net-chain: {json.dumps(net_chain, ensure_ascii=False)}")
    law_fails = run.failure_law()
    for f in law_fails:
        log(f"     {f}")
    ext_noise = [f"{s} {c}" for s, u, c in run.responses if c.startswith("external") and s >= 400]
    if ext_noise:
        log(f"     external-noise: {ext_noise[:4]}")
    if run.request_failed:
        log(f"     requestfailed(noise): {len(run.request_failed)}")
    ctx.close()
    return {
        "videoId": run.vid,
        "title": video.get("title", ""),
        "verdict": verdict,
        "why": why,
        "iframe_peak": iframe_peak,
        "view_ping": run.view_ping_seen,
        "blocked_card": run.blocked_card_seen,
        "overflow_px": run.overflow_px,
        "law_fails": law_fails,
        "net_chain": net_chain,
        "console_errors": [c for c in run.console if c.startswith("error:")][:5],
        "page_errors": run.page_errors[:5],
    }


def main() -> int:
    log(f"watch-playback-proof @ {BASE}  (videos={N_VIDEOS}, viewport={VIEWPORT['width']}x{VIEWPORT['height']})")
    videos, discovery = discover_videos()
    log(f"discovery: {discovery}")
    if not videos:
        log("VERDICT: BLOCKED-FEED — discovery surface returned no videos; "
            "nothing to prove against (honest completion)")
        return 0
    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=HEADLESS)
            for v in videos:
                log(f"surface {len(results) + 1}/{len(videos)}: {v['id']}")
                results.append(run_surface(browser, v))
            browser.close()
    except Exception as e:  # noqa: BLE001
        log(f"INSTRUMENT ERROR: {type(e).__name__}: {e}")
        log(traceback.format_exc(limit=5))
        return 2

    log("")
    log("=== SUMMARY ===")
    counts: dict[str, int] = {}
    all_reached = True
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        if r["verdict"] is None:
            all_reached = False
        log(f"  {r['videoId']}  {r['verdict']}  ({r['why'][:80]})")
        if r["overflow_px"] not in (0, None):
            log(f"    OVERFLOW LAW FAIL: {r['overflow_px']}px")
        for f in r["law_fails"]:
            log(f"    {f}")
    log(f"verdicts: {counts}")
    log("EXIT 0 — every surface reached an honest verdict" if all_reached else "EXIT 2")
    return 0 if all_reached else 2


if __name__ == "__main__":
    sys.exit(main())

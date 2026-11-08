#!/bin/sh
''':'
exec /home/z/.venv/bin/python "$0" "$@"
'''
"""tiktok-playback-proof.py — the M1 playback-proof instrument (WFX2-M1-A).

Distinguishes REAL TikTok VOD playback from a merely-mounted iframe, against
the live WebFlix deployment, and records an honest verdict per surface:

  PLAYING     onPlayerReady + onStateChange=1 + onCurrentTime progression,
              all observed through the official postMessage protocol AND
              trusted exactly the way the app trusts it (event.origin is
              https://www.tiktok.com AND event.source is a mounted player
              iframe). iframe-mounted is NOT playing.
  GEO-WALLED  the tiktok.com player request from THIS network was redirected
              off the /player/v1/<id> path onto a landing page (the ADR 0004
              wall signature: 302 -> /hk/about et al.) or answered blocked
              (4xx/5xx from tiktok.com). Signature recorded, never assumed.
  NO-PLAYER   no player iframe mounted, or the app rendered its honest
              error/readiness-timeout banners, or no protocol evidence
              arrived within the budget — with the real page reason.

Surfaces (the dispatch's three):
  1. /shorts?source=tiktok              — the 9:16 feed player
  2. /tiktok/v/6718335390845095173      — compat deep link (@scout2015)
  3. /tiktok/v/7206561191609716014      — compat deep link (@melodizeai)
Surfaces 2/3 server-redirect into the shared feed with the post spliced
active (ADR 0013 §7) — the final URL is recorded so the redirect is visible.

MEASURED per surface:
  a. network truth of the TikTok player: every tiktok.com-host response is
     captured; the /player/v1/<id> request chain is reconstructed hop by hop
     (final status + final URL + content-type). We NEVER fetch TikTok
     ourselves — only what the viewer browser fetches.
  b. iframe presence + count: tiktok.com/player iframes mounted, sampled
     through the run; the exactly-one law across the UI-exposed next/prev
     navigation (the pause-then-unmount beat allows a transient 2, settled
     must be 1; >2 concurrent or a >1 at-rest count is a broken mount law).
  c. host-side protocol observations: console errors, page errors, the
     app's honest banners (error / readiness-timeout / tap-to-play), the
     app's own /api/tiktok/player-events telemetry POSTs, and the mirrored
     protocol messages (a).
  d. the P103-mini-6 failure law (copied from mobile-375-walk.py): origin
     404/5xx FAIL (the designed /api/tiktok/live* 5xx degrade lane is
     noise), external CDN gaps noise, 400/401/403 designed contracts noise,
     requestfailed (incl. our own navigation ERR_ABORTED) recorded noise.
  e. horizontal overflow law: documentElement.scrollWidth - clientWidth == 0.

Verdict precedence: PLAYING (full evidence) > GEO-WALLED (explains the
absence of play) > NO-PLAYER. Exit 0 iff every surface reached a verdict and
no failure-law/overflow/page-error/mount-law violation was found. A
GEO-WALLED or NO-PLAYER verdict is DATA, not an instrument failure.

Usage:
  bash scripts/ops/tiktok-playback-proof.py            # prod default
  WEBFLIX_BASE_URL=http://localhost:3000 bash scripts/ops/tiktok-playback-proof.py
  PROOF_VIEWPORT=375x812 bash scripts/ops/tiktok-playback-proof.py
  bash scripts/ops/tiktok-playback-proof.py --selftest # the pins, offline
  bash scripts/ops/tiktok-playback-proof.py --help

Env:
  WEBFLIX_BASE_URL   default https://webflix-2-0-tepa.vercel.app
  PROOF_TIMEOUT_S    per-surface protocol observation budget (default 60)
  PROOF_VIEWPORT     WxH (default 1280x800; WALK_VIEWPORT also honored)
  PROOF_SETTLE_MS    initial post-load settle (default 8000)

The shim at the top makes `bash`/`sh` invocations exec
/home/z/.venv/bin/python (the only interpreter this instrument runs under);
direct python3 invocations see that shim as the module docstring opener.
Observation only: no media-byte extraction, no proxying, no auth, no posts.
"""

import os
import re
import sys
import time
from urllib.parse import urlparse

BASE = os.environ.get("WEBFLIX_BASE_URL", "https://webflix-2-0-tepa.vercel.app").rstrip("/")
PROOF_TIMEOUT_S = int(os.environ.get("PROOF_TIMEOUT_S", "60"))
PROOF_SETTLE_MS = int(os.environ.get("PROOF_SETTLE_MS", "8000"))
TIKTOK_PLAYER_ORIGIN = "https://www.tiktok.com"
TIKTOK_PLAYER_PATH = "/player/v1/"

# The DESIGNED honest-degrade lane (the walk's law, copied verbatim).
LIVE_LANE_PREFIX = "/api/tiktok/live"

PLAYER_PATH_RE = re.compile(r"/player/v1/\d{6,32}")

SURFACES = [
    {"key": "shorts-feed", "path": "/shorts?source=tiktok", "post": None},
    {"key": "deep-scout2015", "path": "/tiktok/v/6718335390845095173", "post": "6718335390845095173"},
    {"key": "deep-melodizeai", "path": "/tiktok/v/7206561191609716014", "post": "7206561191609716014"},
]


# ---------------------------------------------------------------------------
# pure, pinnable logic
# ---------------------------------------------------------------------------

def parse_viewport(raw):
    """'WxH' -> dict; absent/garbage -> the 1280x800 desktop proof default."""
    raw = (raw or "").strip().lower()
    try:
        w, h = raw.split("x")
        w, h = int(w), int(h)
        if w >= 200 and h >= 200:
            return {"width": w, "height": h}
    except (ValueError, AttributeError):
        pass
    return {"width": 1280, "height": 800}


def classify_status(status, url, base=BASE):
    """'fail' | 'noise' | None — the P103-mini-6 failure law (walk copy)."""
    if status is None or status < 400:
        return None
    try:
        u_host = urlparse(url).netloc
        b_host = urlparse(base).netloc
    except (ValueError, AttributeError):
        return "noise"
    if u_host != b_host:
        return "noise"  # external CDNs / TikTok's own domain responses
    if status == 404:
        return "fail"  # an origin route answered route-not-found
    if status >= 500:
        path = urlparse(url).path
        if path.startswith(LIVE_LANE_PREFIX):
            return "noise"  # the designed quota-death answer class
        return "fail"  # an origin 5xx outside the designed degrade lane
    return "noise"  # 400/401/403: designed validation/auth contracts


def classify_request_failure(failure, url, base=BASE):
    """'noise' always — requestfailed entries are recorded, never fatal
    (navigation ERR_ABORTED, unmount-interrupted iframe loads, external
    CDN gaps). Kept pure so the pin says so."""
    return "noise"


def is_tiktok_host(url):
    try:
        host = urlparse(url).netloc.lower()
    except (ValueError, AttributeError):
        return False
    return host == "tiktok.com" or host.endswith(".tiktok.com")


def is_player_url(url):
    """True for the official Embed Player shape www.tiktok.com/player/v1/<id>."""
    if not is_tiktok_host(url):
        return False
    return bool(PLAYER_PATH_RE.search(urlparse(url).path or ""))


def strip_query(url):
    """scheme://host+path — the sanitize law for every printed URL (no
    signed queries, no tokens, ever)."""
    try:
        u = urlparse(url)
        return f"{u.scheme}://{u.netloc}{u.path}"
    except (ValueError, AttributeError):
        return "<unparsable>"


def player_redirect_signature(final_url, final_status):
    """'ok' | 'redirect-wall' | 'error-status' | 'pending' for ONE
    /player/v1/<id> request chain (final hop). The wall signature is the
    chain leaving the player path (the ADR 0004 /hk/about class) — status
    and landing URL recorded verbatim; a blocked answer (>=400) from
    tiktok.com on the player path is the blocked class."""
    if final_url is None:
        return "pending"
    if not is_tiktok_host(final_url):
        return "redirect-wall"  # left TikTok's player entirely
    if is_player_url(final_url):
        if final_status is None:
            return "pending"
        if final_status < 400:
            return "ok"
        return "error-status"
    return "redirect-wall"  # tiktok.com, but NOT the player path = landing


def aggregate_player_signatures(sigs):
    """One lane verdict from every player chain observed on a surface:
    any ok chain means the lane works from here; else any wall; else any
    blocked; else absent/pending."""
    for want in ("ok", "redirect-wall", "error-status", "pending"):
        if want in sigs:
            return want
    return "absent"


def parse_state_value(value):
    """The documented onStateChange payload: a state number (-1 init /
    0 ended / 1 playing / 2 paused / 3 buffering), parsed defensively —
    the app's own parseStateValue, mirrored."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, dict):
        s = value.get("state")
        if isinstance(s, (int, float)) and not isinstance(s, bool):
            return int(s)
    return None


def parse_time_value(value):
    """The onCurrentTime payload: seconds, defensively (number or
    {currentTime|time|value: n})."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        for k in ("currentTime", "current_time", "time", "value"):
            v = value.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return float(v)
    return None


def has_progression(times):
    """True when any LATER sample exceeds an EARLIER one by >= 0.5s —
    order-respecting (jitter/loop restarts cannot fake it); this is the
    'observable time progression' law. Empty/single/flat -> False."""
    for i in range(len(times)):
        for j in range(i + 1, len(times)):
            if times[j] - times[i] >= 0.5:
                return True
    return False


def decide_verdict(ready, playing_seen, progression, player_sig,
                   final_url=None, final_status=None, iframe_count=0,
                   error_banner=None, timeout_banner=False):
    """(verdict, reason) — exactly three outcomes, honest by construction.
    Precedence: PLAYING (full protocol evidence) > GEO-WALLED (the measured
    player-request wall/blocked signature) > NO-PLAYER (real page reason)."""
    if ready and playing_seen and progression:
        return "PLAYING", ("onPlayerReady + onStateChange=1 + onCurrentTime "
                           "progression observed through the trusted protocol")
    if player_sig == "redirect-wall":
        return "GEO-WALLED", (f"the tiktok.com player request left the player path -> "
                              f"{strip_query(final_url) if final_url else '<no final URL>'} "
                              f"(final status {final_status}) — the ADR 0004 wall signature")
    if player_sig == "error-status":
        return "GEO-WALLED", (f"the tiktok.com player request was blocked on the player path "
                              f"(final status {final_status} at "
                              f"{strip_query(final_url) if final_url else '<player path>'})")
    if error_banner:
        return "NO-PLAYER", f"app-rendered player error banner: {error_banner}"
    if timeout_banner:
        return "NO-PLAYER", ("app-rendered readiness-timeout banner — the player never "
                             "signaled ready from this network")
    if iframe_count == 0:
        return "NO-PLAYER", "no tiktok.com/player iframe mounted"
    if player_sig == "ok":
        return "NO-PLAYER", (f"player request OK (no wall) but no trusted protocol evidence "
                             f"within the budget — iframe-mounted is not playing; a headless "
                             f"sandbox browser may also lack codec support, so an operator "
                             f"viewer run is required for the playback gate")
    return "NO-PLAYER", (f"no player-request signature and no trusted protocol evidence "
                         f"within the budget — iframe-mounted is not playing")


# ---------------------------------------------------------------------------
# browser-side observation (all read-only mirrors of what the app exposes)
# ---------------------------------------------------------------------------

INSTALL_LISTENER_JS = """() => {
  if (window.__wfx2Proof) return;
  const rec = window.__wfx2Proof = { messages: [] };
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || typeof d !== "object" || d["x-tiktok-player"] !== true) return;
    let fromPlayerIframe = false;
    try {
      for (const f of document.querySelectorAll("iframe")) {
        if (f.contentWindow === ev.source) { fromPlayerIframe = true; break; }
      }
    } catch (e) {}
    rec.messages.push({
      type: typeof d.type === "string" ? d.type : "",
      value: d.value === undefined ? null : d.value,
      origin: ev.origin,
      fromPlayerIframe,
      ts: Date.now(),
    });
  });
}"""

PULL_MESSAGES_JS = """() => {
  const r = window.__wfx2Proof;
  return r ? r.messages.splice(0, r.messages.length) : [];
}"""

IFRAMES_JS = """() => {
  const out = [];
  for (const f of document.querySelectorAll("iframe")) {
    try {
      const src = f.src || "";
      if (src.includes("tiktok.com/player")) {
        out.push(src.replace(/^https:\\/\\/[^/]*tiktok\\.com/, "").split("?")[0]);
      }
    } catch (e) {}
  }
  return out;
}"""

PAGE_STATE_JS = """() => {
  const q = (t) => {
    const el = document.querySelector('[data-testid="' + t + '"]');
    return el ? (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 220) : null;
  };
  return {
    feedMounted: !!document.querySelector('[data-testid="tiktok-feed-player"]'),
    starting: !!document.querySelector('[data-testid="tiktok-feed-starting"]'),
    autoplayBlocked: !!document.querySelector('[data-testid="tiktok-feed-autoplay-blocked"]'),
    error: q("tiktok-feed-player-error"),
    timeout: q("tiktok-feed-player-timeout"),
  };
}"""


class SurfaceCollector:
    """Per-surface network/event collector (fresh page per surface)."""

    def __init__(self, base):
        self.base = base
        self.console_errors = []
        self.page_errors = []
        self.request_failed = []
        self.fail_http = []
        self.noise_http = []
        self.telemetry_posts = []
        self.tiktok_responses = []  # {status, url, ctype, request}

    def bind(self, page):
        page.on("console", lambda m: self.console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        page.on("requestfailed", lambda r: self.request_failed.append(
            f"{strip_query(r.url)} :: {r.failure}"))
        page.on("response", self._on_response)
        page.on("request", self._on_request)

    def _on_response(self, r):
        cls = classify_status(r.status, r.url, self.base)
        entry = f"{r.status} {strip_query(r.url)}"
        if cls == "fail":
            self.fail_http.append(entry)
        elif cls == "noise":
            self.noise_http.append(entry)
        if is_tiktok_host(r.url):
            try:
                ctype = r.header_value("content-type") or ""
            except Exception:
                ctype = ""
            self.tiktok_responses.append(
                {"status": r.status, "url": strip_query(r.url), "ctype": ctype, "request": r.request})

    def _on_request(self, rq):
        try:
            if is_tiktok_host(rq.url):
                return
            u = urlparse(rq.url)
            if u.path == "/api/tiktok/player-events":
                body = None
                try:
                    body = rq.post_data
                except Exception:
                    body = None
                self.telemetry_posts.append(f"POST {u.path} {str(body)[:160]}")
        except (ValueError, AttributeError):
            pass

    # ---- chain reconstruction (must run while the page is still open) -----
    def finalize_tiktok(self):
        chains = []
        roots = {}
        for resp in self.tiktok_responses:
            req = resp["request"]
            root = req
            hops = 0
            while root.redirected_from is not None and hops < 10:
                root = root.redirected_from
                hops += 1
            roots.setdefault(root, []).append(resp)
        for root in roots:
            node = root
            chain_reqs = [node]
            while node.redirected_to is not None and len(chain_reqs) < 12:
                node = node.redirected_to
                chain_reqs.append(node)
            hops = []
            final_url, final_status, final_ctype = None, None, ""
            for cr in chain_reqs:
                r = cr.response()  # a method in the Playwright Python API
                st = r.status if r else None
                hops.append({"url": strip_query(cr.url), "status": st})
                if r:
                    final_url, final_status = strip_query(r.url), r.status
                    try:
                        final_ctype = r.header_value("content-type") or ""
                    except Exception:
                        final_ctype = ""
            chains.append({
                "root": strip_query(root.url),
                "is_player": is_player_url(root.url),
                "final_url": final_url,
                "final_status": final_status,
                "final_ctype": final_ctype.split(";")[0],
                "hops": hops,
                "sig": player_redirect_signature(final_url, final_status),
            })
        player_chains = [c for c in chains if c["is_player"]]
        lane_sig = aggregate_player_signatures([c["sig"] for c in player_chains])
        sdk_scripts = [c["root"] for c in chains
                       if not c["is_player"] and c["root"].endswith(".js")]
        return chains, player_chains, lane_sig, sdk_scripts


# ---------------------------------------------------------------------------
# the walk
# ---------------------------------------------------------------------------

def trust(m):
    """The app's INBOUND LAW, mirrored: origin is the TikTok player origin
    AND the message came from a mounted player iframe."""
    return m.get("origin") == TIKTOK_PLAYER_ORIGIN and m.get("fromPlayerIframe") is True


def sample_page(page):
    """iframes + banners + overflow, once."""
    iframes = page.evaluate(IFRAMES_JS)
    state = page.evaluate(PAGE_STATE_JS)
    overflow = page.evaluate(
        """() => { const d = document.documentElement;
                   return {px: d.scrollWidth - d.clientWidth, sw: d.scrollWidth, cw: d.clientWidth}; }""")
    return iframes, state, overflow


def click_tap_to_play_if_present(page):
    btn = page.locator('[data-testid="tiktok-feed-autoplay-blocked"]')
    if btn.count() > 0 and btn.first.is_visible():
        btn.first.click(timeout=5000)
        return True
    return False


def navigate_one(page, aria_label):
    """Click the exposed chevron if the UI offers it; sample the iframe
    count across the pause-then-unmount beat; return (done, samples, pre, post).
    Every slide renders its own chevron pair (prev is index-disabled), so the
    selector targets the ENABLED one — the active slide's."""
    btn = page.locator(f'button[aria-label="{aria_label}"]:not([disabled])')
    try:
        if btn.count() == 0 or not btn.first.is_visible():
            return False, [], None, None
    except Exception:
        return False, [], None, None
    pre = page.evaluate(IFRAMES_JS)
    btn.first.click(timeout=5000)
    samples = []
    for delay in (0.12, 0.3, 0.6, 1.2, 2.0):
        time.sleep(max(0.0, delay - (samples[-1][0] if samples else 0.0)))
        try:
            samples.append((delay, len(page.evaluate(IFRAMES_JS))))
        except Exception:
            break
    page.wait_for_timeout(1500)
    try:
        post = page.evaluate(IFRAMES_JS)
    except Exception:
        post = None
    return True, samples, pre, post


def prove_surface(page, surface):
    collector = SurfaceCollector(BASE)
    collector.bind(page)
    res = {"key": surface["key"], "path": surface["path"], "expected_post": surface["post"]}

    t0 = time.time()
    page.goto(BASE + surface["path"], wait_until="load", timeout=45_000)
    res["landed_url"] = page.url
    page.evaluate(INSTALL_LISTENER_JS)
    page.wait_for_timeout(PROOF_SETTLE_MS)

    budget = time.time() + PROOF_TIMEOUT_S
    ready = playing_seen = False
    time_vals = []
    states_seen = []
    msg_counts = {}
    trusted_msg_counts = {}
    iframe_samples = []
    last_state = {}
    overflow = {"px": None, "sw": None, "cw": None}
    autoplay_pressed = False

    while time.time() < budget:
        for m in page.evaluate(PULL_MESSAGES_JS):
            t = m.get("type", "")
            msg_counts[t] = msg_counts.get(t, 0) + 1
            if trust(m):
                trusted_msg_counts[t] = trusted_msg_counts.get(t, 0) + 1
                if t == "onPlayerReady":
                    ready = True
                elif t == "onStateChange":
                    st = parse_state_value(m.get("value"))
                    if st is not None:
                        states_seen.append(st)
                        if st == 1:
                            playing_seen = True
                elif t == "onCurrentTime":
                    tv = parse_time_value(m.get("value"))
                    if tv is not None:
                        time_vals.append(tv)
        try:
            iframes, last_state, overflow = sample_page(page)
            iframe_samples.append((round(time.time() - t0, 1), len(iframes)))
        except Exception:
            break  # page torn down mid-observation
        if autoplay_blocked := last_state.get("autoplayBlocked"):
            if not autoplay_pressed and click_tap_to_play_if_present(page):
                autoplay_pressed = True
                continue
        sig_probe = "absent"
        try:
            _, player_chains, lane_sig, _ = collector.finalize_tiktok()
            sig_probe = lane_sig
        except Exception:
            sig_probe = "absent"
        if ready and playing_seen and has_progression(time_vals):
            break  # PLAYING evidence complete — nothing more to learn here
        if sig_probe in ("redirect-wall", "error-status") and (time.time() - t0) >= 25:
            break  # wall measured + past the app's own 12s readiness budget
        page.wait_for_timeout(1_000)

    res["ready"] = ready
    res["playing_seen"] = playing_seen
    res["time_vals_n"] = len(time_vals)
    res["time_first_last"] = (time_vals[0], time_vals[-1]) if time_vals else None
    res["progression"] = has_progression(time_vals)
    res["states_seen"] = states_seen[:40]
    res["msg_counts"] = msg_counts
    res["trusted_msg_counts"] = trusted_msg_counts
    res["iframe_samples"] = iframe_samples[:40]
    res["state"] = last_state
    res["overflow"] = overflow
    res["autoplay_pressed"] = autoplay_pressed

    # ---- the UI-exposed next/prev navigation + the exactly-one law --------
    nav = {}
    for label in ("Next short", "Previous short"):
        done, samples, pre, post = navigate_one(page, label)
        if done:
            nav[label] = {"beat_samples": samples, "pre": pre, "post": post}
            page.wait_for_timeout(2_500)
            for m in page.evaluate(PULL_MESSAGES_JS):
                t = m.get("type", "")
                msg_counts[t] = msg_counts.get(t, 0) + 1
                if trust(m):
                    trusted_msg_counts[t] = trusted_msg_counts.get(t, 0) + 1
                    if t == "onPlayerReady":
                        ready = True
                    elif t == "onStateChange":
                        st = parse_state_value(m.get("value"))
                        if st is not None:
                            states_seen.append(st)
                            if st == 1:
                                playing_seen = True
                    elif t == "onCurrentTime":
                        tv = parse_time_value(m.get("value"))
                        if tv is not None:
                            time_vals.append(tv)
    res["nav"] = nav
    res["msg_counts"] = msg_counts
    res["trusted_msg_counts"] = trusted_msg_counts

    # ---- final measurements ------------------------------------------------
    try:
        iframes, last_state, overflow = sample_page(page)
        res["iframes_final"] = iframes
        res["state"] = last_state
        res["overflow"] = overflow
    except Exception:
        res["iframes_final"] = None

    chains, player_chains, lane_sig, sdk_scripts = collector.finalize_tiktok()
    res["tiktok_chains"] = [{k: c[k] for k in ("root", "final_url", "final_status",
                                               "final_ctype", "sig", "hops")}
                            for c in chains[:12]]
    res["player_chains"] = [{k: c[k] for k in ("root", "final_url", "final_status",
                                               "final_ctype", "sig", "hops")}
                            for c in player_chains[:6]]
    res["lane_sig"] = lane_sig
    res["sdk_scripts"] = sdk_scripts[:8]
    res["console_errors"] = collector.console_errors[:10]
    res["page_errors"] = collector.page_errors[:10]
    res["request_failed"] = collector.request_failed[:10]
    res["fail_http"] = collector.fail_http[:10]
    res["noise_http"] = collector.noise_http[:10]
    res["telemetry_posts"] = collector.telemetry_posts[:6]

    wall = lane_sig in ("redirect-wall", "error-status")
    final = player_chains[0] if player_chains else None
    verdict, reason = decide_verdict(
        ready=ready,
        playing_seen=playing_seen,
        progression=res["progression"],
        player_sig=lane_sig,
        final_url=final["final_url"] if final else None,
        final_status=final["final_status"] if final else None,
        iframe_count=len(res["iframes_final"] or []),
        error_banner=last_state.get("error"),
        timeout_banner=bool(last_state.get("timeout")),
    )
    res["verdict"] = verdict
    res["reason"] = reason
    res["wall_measured"] = wall
    res["elapsed_s"] = round(time.time() - t0, 1)
    return res


def print_result(r):
    print(f"\n--- surface {r['key']} ({r['path']}) ---")
    print(f"  landed: {r['landed_url']}")
    print(f"  verdict: {r['verdict']}")
    print(f"  reason: {r['reason']}")
    print(f"  ready={r['ready']} playing_state_seen={r['playing_seen']} "
          f"progression={r['progression']} (time samples={r['time_vals_n']}, "
          f"first/last={r['time_first_last']})")
    print(f"  onStateChange states: {r['states_seen']}")
    print(f"  protocol msgs (all/trusted): {r['msg_counts']} / {r['trusted_msg_counts']}")
    print(f"  iframes at rest: {r['iframes_final']}  samples: {r['iframe_samples']}")
    st = r["state"] or {}
    print(f"  app banners: error={st.get('error')!r} timeout={st.get('timeout')!r} "
          f"starting={st.get('starting')} autoplayBlocked={st.get('autoplayBlocked')}")
    print(f"  tap-to-play pressed by instrument: {r['autoplay_pressed']}")
    print(f"  overflow: {r['overflow']['px']}px (sw={r['overflow']['sw']} cw={r['overflow']['cw']})")
    print(f"  player lane signature: {r['lane_sig']}")
    for c in r["player_chains"]:
        hops = " -> ".join(f"{h['status']} {h['url']}" for h in c["hops"])
        print(f"    player chain: {hops or c['root']}  [final {c['final_status']} "
              f"{c['final_ctype']}] sig={c['sig']}")
    for c in r["tiktok_chains"]:
        if not c["root"].startswith(str(TIKTOK_PLAYER_PATH)) and "/player/v1/" not in c["root"]:
            print(f"    tiktok.com response: {c['final_status']} {c['root']} "
                  f"({c['final_ctype'] or '-'}) sig={c['sig']}")
    if r["sdk_scripts"]:
        print(f"  tiktok.com scripts observed: {r['sdk_scripts']}")
    for t in r["telemetry_posts"]:
        print(f"  app telemetry: {t}")
    for e in r["console_errors"]:
        print(f"  console.error: {e[:180]}")
    for e in r["page_errors"]:
        print(f"  PAGE ERROR: {e[:180]}")
    for f_ in r["fail_http"]:
        print(f"  HTTP-LAW-FAIL: {f_[:180]}")
    for n in r["noise_http"][:5]:
        print(f"  http-noise: {n[:180]}")
    for rf in r["request_failed"][:5]:
        print(f"  requestfailed(noise): {rf[:180]}")
    for label, nav in r["nav"].items():
        post = nav["post"]
        print(f"  nav {label!r}: beat samples={nav['beat_samples']} "
              f"pre={[nav['pre']] if nav['pre'] else '-'} -> "
              f"at-rest after={[post] if post else '-'}")
    print(f"  elapsed: {r['elapsed_s']}s")


def selftest():
    base = "https://webflix-2-0-tepa.vercel.app"
    player = "https://www.tiktok.com/player/v1/6718335390845095173?music_info=1"
    cases = []

    def pin(desc, expected, got):
        cases.append((desc, expected, got))

    # --- the ADR 0004 geo-wall signature law -------------------------------
    pin("player 200 on the player path is ok",
        "ok", player_redirect_signature(player, 200))
    pin("redirect to /hk/about is the wall signature",
        "redirect-wall", player_redirect_signature("https://www.tiktok.com/hk/about?lang=en", 200))
    pin("redirect to /about is the wall signature",
        "redirect-wall", player_redirect_signature("https://www.tiktok.com/about", 200))
    pin("redirect off tiktok entirely is the wall signature",
        "redirect-wall", player_redirect_signature("https://example.com/landing", 200))
    pin("player path 403 is the blocked signature",
        "error-status", player_redirect_signature(player, 403))
    pin("no final response yet is pending",
        "pending", player_redirect_signature(None, None))
    # --- the lane aggregator ------------------------------------------------
    pin("any ok chain makes the lane ok (wall on one post ≠ lane dead)",
        "ok", aggregate_player_signatures(["redirect-wall", "ok"]))
    pin("all-wall lanes are the wall",
        "redirect-wall", aggregate_player_signatures(["redirect-wall", "redirect-wall"]))
    pin("blocked-only lanes are blocked",
        "error-status", aggregate_player_signatures(["error-status"]))
    pin("no chains at all is absent",
        "absent", aggregate_player_signatures([]))
    pin("pending alone stays pending",
        "pending", aggregate_player_signatures(["pending"]))
    # --- the P103-mini-6 failure law (copied from the walk) -----------------
    pin("origin /api/me 500 FAILS (the P103-mini-5 catch)",
        "fail", classify_status(500, base + "/api/me", base))
    pin("origin 404 FAILS",
        "fail", classify_status(404, base + "/api/does-not-exist", base))
    pin("designed live-lane 503 is noise",
        "noise", classify_status(503, base + "/api/tiktok/live?handle=lofigirl", base))
    pin("origin 401 guest gate is noise",
        "noise", classify_status(401, base + "/api/connection/tiktok", base))
    pin("external ytimg 404 is noise",
        "noise", classify_status(404, "https://i.ytimg.com/vi/x/oar.jpg", base))
    pin("tiktok.com 403 is noise for the page law (its own verdict lane owns it)",
        "noise", classify_status(403, player, base))
    pin("healthy 200 is None",
        None, classify_status(200, base + "/api/tiktok/feed", base))
    pin("a 302 is None",
        None, classify_status(302, base + "/tiktok/v/6718335390845095173", base))
    pin("requestfailed (incl. own-nav ERR_ABORTED) is recorded noise",
        "noise", classify_request_failure("net::ERR_ABORTED", player, base))
    # --- URL/sanitize laws ---------------------------------------------------
    pin("the player URL matches the player shape",
        True, is_player_url(player))
    pin("a hub page URL is not a player URL",
        False, is_player_url("https://www.tiktok.com/hk/about"))
    pin("strip_query removes any query (sanitize law)",
        "https://www.tiktok.com/player/v1/123",
        strip_query("https://www.tiktok.com/player/v1/123?token=SECRET"))
    # --- protocol parsing (the app's defensive mirrors) ---------------------
    pin("onStateChange numeric 1 parses",
        1, parse_state_value(1))
    pin("onStateChange {state:2} parses",
        2, parse_state_value({"state": 2}))
    pin("onStateChange garbage is None",
        None, parse_state_value("playing"))
    pin("onCurrentTime numeric parses",
        3.5, parse_time_value(3.5))
    pin("onCurrentTime {currentTime:n} parses",
        3.5, parse_time_value({"currentTime": 3.5}))
    pin("onCurrentTime garbage is None",
        None, parse_time_value({"nope": True}))
    # --- the progression law -------------------------------------------------
    pin("no time samples -> no progression",
        False, has_progression([]))
    pin("one flat sample -> no progression",
        False, has_progression([1.0]))
    pin("repeating the same time -> no progression (buffering ≠ playing)",
        False, has_progression([1.0, 1.0, 1.0]))
    pin("time advancing >= 0.5s IS progression",
        True, has_progression([1.0, 1.5, 3.0]))
    pin("a later jump after jitter IS progression (order-respecting)",
        True, has_progression([5.0, 4.9, 12.0]))
    # --- the verdict machine -------------------------------------------------
    pin("full play evidence -> PLAYING",
        "PLAYING", decide_verdict(True, True, True, "ok")[0])
    pin("wall signature, no play evidence -> GEO-WALLED",
        "GEO-WALLED", decide_verdict(False, False, False, "redirect-wall",
                                     "https://www.tiktok.com/hk/about", 200)[0])
    pin("blocked player request -> GEO-WALLED",
        "GEO-WALLED", decide_verdict(False, False, False, "error-status", player, 403)[0])
    pin("ready but no playing state -> NO-PLAYER (cannot claim PLAYING)",
        "NO-PLAYER", decide_verdict(True, False, False, "ok", player, 200, 1)[0])
    pin("playing state but no time progression -> NO-PLAYER",
        "NO-PLAYER", decide_verdict(True, True, False, "ok", player, 200, 1)[0])
    pin("app error banner -> NO-PLAYER with the banner",
        "NO-PLAYER", decide_verdict(False, False, False, "ok", player, 200, 1,
                                    error_banner="This post can't be embedded (code 1001)")[0])
    pin("app readiness-timeout banner -> NO-PLAYER",
        "NO-PLAYER", decide_verdict(False, False, False, "pending", None, None, 1,
                                    timeout_banner=True)[0])
    pin("no iframe mounted -> NO-PLAYER",
        "NO-PLAYER", decide_verdict(False, False, False, "absent", None, None, 0)[0])
    pin("iframe mounted, zero evidence -> NO-PLAYER (iframe-mounted ≠ playing)",
        "NO-PLAYER", decide_verdict(False, False, False, "ok", player, 200, 1)[0])
    pin("PLAYING beats a stray wall signature (play evidence wins)",
        "PLAYING", decide_verdict(True, True, True, "redirect-wall")[0])
    # --- viewport law ---------------------------------------------------------
    for raw, want in [("", {"width": 1280, "height": 800}),
                      ("garbage", {"width": 1280, "height": 800}),
                      ("375x812", {"width": 375, "height": 812}),
                      ("100x100", {"width": 1280, "height": 800}),
                      ("1440x900", {"width": 1440, "height": 900})]:
        pin(f"viewport {raw!r}", want, parse_viewport(raw))

    bad = 0
    for desc, expected, got in cases:
        ok = expected == got
        print(f"  [{'ok' if ok else 'MISMATCH'}] {desc}: got={got!r}")
        if not ok:
            bad += 1
    if bad:
        print(f"SELFTEST FAIL ({bad}/{len(cases)} pins broken)")
        return 1
    print(f"SELFTEST PASS — {len(cases)} pins hold (wall signature, failure law, "
          f"progression, verdict machine, viewport).")
    return 0


USAGE = """usage: tiktok-playback-proof.py [--selftest | --help]
  WEBFLIX_BASE_URL=<url>   base to prove (default https://webflix-2-0-tepa.vercel.app)
  PROOF_TIMEOUT_S=<s>      per-surface protocol observation budget (default 60)
  PROOF_VIEWPORT=WxH       viewport override (default 1280x800; WALK_VIEWPORT honored)
  PROOF_SETTLE_MS=<ms>     initial post-load settle (default 8000)
surfaces: /shorts?source=tiktok, /tiktok/v/6718335390845095173, /tiktok/v/7206561191609716014
"""


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--help" in sys.argv or "-h" in sys.argv:
        print(USAGE)
        return 0

    from playwright.sync_api import sync_playwright

    viewport = parse_viewport(os.environ.get("PROOF_VIEWPORT") or os.environ.get("WALK_VIEWPORT") or "")
    label = f"{viewport['width']}x{viewport['height']}"
    results = []
    violations = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for surface in SURFACES:
            ctx = browser.new_context(viewport=viewport, device_scale_factor=2)
            page = ctx.new_page()
            try:
                r = prove_surface(page, surface)
            except Exception as e:  # the walk itself must never lie by dying silently
                r = {"key": surface["key"], "path": surface["path"], "verdict": "NO-PLAYER",
                     "reason": f"instrument error during the walk: {e!r}"[:300],
                     "error": True}
                print(f"\n--- surface {surface['key']} ---\n  INSTRUMENT ERROR: {e!r}")
            print_result(r) if "error" not in r else None
            results.append(r)
            # ---- the mechanical laws ---------------------------------------
            if r.get("error"):
                violations.append(f"{surface['key']}: instrument error — no verdict (see log)")
                continue
            ov = r.get("overflow") or {}
            if ov.get("px") not in (None, 0):
                violations.append(f"{surface['key']}: horizontal overflow {ov['px']}px")
            for pe in r.get("page_errors", [])[:3]:
                violations.append(f"{surface['key']}: page error: {pe[:150]}")
            for hf in r.get("fail_http", [])[:5]:
                violations.append(f"{surface['key']}: HTTP failure-law hit: {hf[:150]}")
            at_rest = [len(x) for x in [r.get("iframes_final") or []] if x is not None]
            if at_rest and at_rest[0] > 1:
                violations.append(f"{surface['key']}: {at_rest[0]} tiktok player iframes at rest "
                                  f"(exactly-one law)")
            for lbl, nav in (r.get("nav") or {}).items():
                beat_max = max((c for _, c in nav["beat_samples"]), default=0)
                if beat_max > 2:
                    violations.append(f"{surface['key']}: {beat_max} concurrent player iframes "
                                      f"during {lbl!r} (mount law allows the 2-frame beat only)")
                if nav["post"] is not None and len(nav["post"]) > 1:
                    violations.append(f"{surface['key']}: {len(nav['post'])} player iframes settled "
                                      f"after {lbl!r} (exactly-one law)")
            ctx.close()
        browser.close()

    print("\n==== M1 PLAYBACK-PROOF VERDICTS ====")
    for r in results:
        print(f"  [{r['verdict']}] {r['key']}  — {r['reason'][:220]}")

    if violations:
        print("\nFAIL — the mechanical laws found problems:")
        for v in violations:
            print(f"  - {v}")
        return 1
    print(f"\nPASS — all {len(results)} surfaces reached a verdict at {label}; "
          "0px overflow everywhere; the failure law and the exactly-one mount law "
          "found nothing. Verdicts above are the measured truth (GEO-WALLED / "
          "NO-PLAYER are valid outcomes, not instrument failures).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

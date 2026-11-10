#!/bin/sh
''':'
exec /home/z/.venv/bin/python "$0" "$@"
'''
"""player-host-proof.py — the player-host survival-matrix instrument (WFX2-HOST-1).

Proves the WFX2-C-S persistent-player contract on the REAL page — the
"wrapper never unmounts" law — WITHOUT needing playback (the wrapper
mechanics are DOM truth, independent of which lane hosts the video and of
the embed wall; the wall state is WATCH-PLAY-1's measurement).

The law under test (player-host.ts's own doc, verbatim claims):
  S1 ATTACH-INLINE    /watch/<id> takes the player inline: the persistent
                      wrapper (div[data-wfx-player-host], created lazily
                      ONCE per session) is connected and NOT hosted by the
                      mini; the mini region is not visible on arrival.
  S2 LEAVE -> MINI    client-side nav off /watch (the topbar logo): the
                      SAME wrapper node lands in the mini's video area and
                      the mini region becomes visible. Node identity is
                      proven by a JS tag set on the wrapper at S1.
  S3 EXPAND -> INLINE the mini's Expand button (on a non-watch route)
                      navigates to /watch/<id> and the SAME tagged wrapper
                      returns inline; the mini is no longer visible.
  S4 TAKEOVER         watch -> watch via a REAL related-rail link (non-zero
                      bbox, different id): the URL changes, the wrapper
                      stays inline, the tag survives, and THE MINI NEVER
                      FLASHES (release->limbo->rAF must be a no-op because
                      the new slot registers in the same commit) — sampled
                      by a MutationObserver on the region's class.
  S5 SCROLL-DOCK      on /watch, scrolling the player's anchor past the top
                      docks the player bottom-right (setMini(true): the
                      wrapper's host becomes the mini WHILE the URL is still
                      /watch); scrolling back undocks to inline.
  S6 CLOSE-DESTROY    the mini's Close is the ONLY destroy path: the mini
                      region unmounts and the wrapper is DISCONNECTED
                      (limbo) — but the wrapper NODE is a session singleton
                      (ensureWrapper never nulls it), so the NEXT attach
                      must return THE SAME TAGGED NODE to service with a
                      fresh lane inside (S6-REATTACH-SAME-NODE).

Surfaces: discovered dynamically (the COVERAGE-4 law): /api/videos?limit=8
-> the first id; the takeover target is the first DIFFERENT real (bbox'd)
/watch/<id> anchor on the page's own related rail (zero hardcoded ids).
Feed empty -> one search-compose retry (?q=lofigirl) -> still empty:
BLOCKED-FEED.

Click honesty: SPA-navigation clicks get up to 3 attempts (click -> poll
the URL -> re-hover) and the ATTEMPT COUNT is recorded in the step's why —
a click that only navigates on retry is an observed flake-class residual,
printed and counted, never silently swallowed (the G6-class discipline).
Only REAL anchors (non-null bounding box) are clicked — the home page
carries designed zero-size ghost /watch anchors that must not drive the
measurement (observed on prod: visible=True, bbox=None).

Honesty: every assertion is page-truth; a step that cannot run prints
[SKIP-CLASS] with the real reason and does NOT count as a law break — the
law is only broken by a measured contradiction (wrong host, wrong
visibility, tag lost, mini flash on takeover, etc.). Exit 0 = every
runnable step held; exit 1 = a law broke (a real defect); exit 2 =
instrument error.

Env: WEBFLIX_BASE_URL (default http://localhost:3000),
     HOST_HEADLESS (default 1), HOST_VIEWPORT (default 1440x900).
"""

import json
import os
import sys
import time
import traceback
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("WEBFLIX_BASE_URL", "http://localhost:3000").rstrip("/")
HEADLESS = os.environ.get("HOST_HEADLESS", "1") != "0"
_vw, _vh = (os.environ.get("HOST_VIEWPORT", "1440x900").split("x") + ["900"])[:2]
VIEWPORT = {"width": int(_vw), "height": int(_vh)}

WRAPPER_SEL = "div[data-wfx-player-host]"
MINI_REGION = '[role="region"][aria-label="Miniplayer"]'
EXPAND_BTN = 'button[aria-label="Expand miniplayer"]'
CLOSE_BTN = 'button[aria-label="Close miniplayer"]'
HOME_LINK = 'a[href="/"]'


def log(msg: str) -> None:
    print(msg, flush=True)


def discover_video() -> tuple[dict | None, str]:
    for url, note in (
        (f"{BASE}/api/videos?limit=8", "live-feed"),
        (f"{BASE}/api/videos?limit=8&q=lofigirl", "search-compose"),
    ):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                vids = [v for v in json.load(r).get("videos", []) if v.get("id")]
            if vids:
                return vids[0], note
        except Exception as e:  # noqa: BLE001
            return None, f"{note}: ERROR {type(e).__name__}: {e}"
    return None, "both discovery rungs returned no videos"


# ---- page-truth JS ------------------------------------------------------

JS_WRAPPER_STATE = """(tag) => {
  const el = document.querySelector('div[data-wfx-player-host]');
  if (!el) return { exists: false };
  let node = el, host = 'other';
  while (node) {
    if (node.nodeType === 1 && node.getAttribute
        && node.getAttribute('aria-label') === 'Miniplayer') { host = 'mini'; break; }
    node = node.parentElement;
  }
  return {
    exists: true, connected: el.isConnected, host,
    tagged: tag !== null && el.__wfx2_probe_tag === tag,
    actualTag: el.__wfx2_probe_tag ?? null,
    childCount: el.childElementCount,
  };
}"""

JS_MINI_VISIBLE = """() => {
  const r = document.querySelector('[role="region"][aria-label="Miniplayer"]');
  if (!r) return { present: false, visible: false };
  const cs = getComputedStyle(r);
  return { present: true,
           visible: cs.opacity === '1' && cs.pointerEvents !== 'none' };
}"""

JS_SCROLL_ALL_BOTTOM = """() => {
  window.scrollTo(0, 2500);
  let n = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(cs.overflowY)
        && el.scrollHeight > el.clientHeight + 50) {
      el.scrollTop = el.scrollHeight; n++;
    }
  }
  return n;
}"""

JS_SCROLL_ALL_TOP = """() => {
  window.scrollTo(0, 0);
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(cs.overflowY)
        && el.scrollHeight > el.clientHeight + 50) el.scrollTop = 0;
  }
  return true;
}"""

JS_REAL_WATCH_ANCHORS = """(curId) => Array.from(document.querySelectorAll('a[href^="/watch/"]'))
  .map(a => ({ href: a.getAttribute('href'), box: a.getBoundingClientRect() }))
  .filter(x => x.href && x.box && x.box.height > 10 && x.box.width > 10)
  .filter(x => !curId || x.href !== '/watch/' + curId)
  .map(x => x.href)"""


# ---- helpers ------------------------------------------------------------

def wait_wrapper(page, timeout=15.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        st = page.evaluate(JS_WRAPPER_STATE, None)
        if st.get("exists") and st.get("connected"):
            return st
        time.sleep(0.3)
    return page.evaluate(JS_WRAPPER_STATE, None)


def tag_wrapper(page, tag):
    page.eval_on_selector(WRAPPER_SEL, "(el, t) => { el.__wfx2_probe_tag = t; }", tag)


def settle(page, ms=700):
    page.wait_for_timeout(ms)


# ---- WFX2-EXPAND-DIAG-1: S3 evidence bundle -------------------------------
# The HOST-1 catch (S3 expand never navigates on prod; try2/3 hit click
# TimeoutError) reproduced 2/2 in the interleaved differential while the
# standalone diag (same cadence, probes installed) passed 4/4. This bundle
# installs the diag's page-truth probes into THIS instrument's S3 path so a
# failing run carries its own evidence: history spies (did the click reach
# Next's nav pipeline?), a 250ms state timeline (URL / push count / mini
# opacity+pointerEvents / wrapper host), and click-TimeoutError forensics.
# If probes alone flip the outcome, the mechanism is TIMING-SENSITIVE —
# that is also a pinned class.
#
# PINNED (WFX2-EXPAND-DIAG-1, this bundle's first failing run): NOT timing-
# sensitive and NOT a product defect. Page truth (pushState spy + 250ms
# sampler + forensics, three independent page-side sources): the trusted
# click reaches the Next router pipeline, pushState commits /watch/<vid>
# at ~800ms and NEVER reverts (zero timeline changes after t=1250ms), the
# mini fades to inline (host=inline-main). The S3 FAIL was an INSTRUMENT
# ARTIFACT: Playwright's page.url lagged the same-document pushState nav
# by >=15s (stale at /) so the poll declared "no nav", and the retry
# clicks hit a button that had ALREADY expanded (region pe:none -> click
# TimeoutError). The S2/S4/S6 "first-click-swallow flake" (attempt-2
# always works) is the same staleness class — attempt 2 just gives CDP
# time to sync. Correction: click_client_nav judges on page-side truth
# (location.pathname) first; page.url is only a fallback.
#
# WFX2-S4-RES (the residual close): S4's hand-rolled post-click poll and
# final judge were the LAST nav judges still on page.url — the takeover
# nav (watch -> watch via the rail) is the SAME same-document class as
# the S3 expand nav, so attempt-1's click committed while the poll
# watched a stale source (the persistent attempt-2 pattern, 4/4 runs).
# Both judges now use the click_client_nav discipline: location.pathname
# first, page.url only when the page cannot be evaluated.
JS_PROBES_S3 = r"""() => {
  if (window.__s3probe) return true;
  const D = window.__s3probe = { t0: performance.now(), push: [], fetches: [], timeline: [] };
  const now = () => Math.round(performance.now() - D.t0);
  for (const name of ['pushState', 'replaceState']) {
    const orig = history[name].bind(history);
    history[name] = function (s, t, u) {
      let via = '?';
      try { via = (new Error().stack || '').split('\n').slice(2, 10).join(' <= ').slice(0, 600); } catch {}
      D.push.push({ ms: now(), url: String(u), kind: name, via });
      return orig(s, t, u);
    };
  }
  const of = window.fetch;
  window.fetch = function (...a) {
    const url = String((a[0] && a[0].url) || a[0] || '');
    const rec = { ms: now(), url: url.slice(0, 200), rsc: url.includes('_rsc'), settled: false };
    if (D.fetches.length < 300) D.fetches.push(rec);
    return of.apply(this, a).then(
      (r) => { rec.settled = true; return r; },
      (e) => { rec.settled = true; rec.err = String(e && e.name); throw e; });
  };
  // -- click census: trusted AND synthetic (element.click()) --
  D.clicks = [];
  document.addEventListener('click', (e) => {
    const t = e.target;
    D.clicks.push({ ms: now(), trusted: e.isTrusted,
      target: t ? (t.getAttribute && (t.getAttribute('aria-label') || t.tagName)) || t.tagName : '?',
      href: t && t.closest && t.closest('a') ? t.closest('a').getAttribute('href') : null });
    if (D.clicks.length > 100) D.clicks.shift();
  }, true);
  D.sampler = setInterval(() => {
    const reg = document.querySelector('[aria-label="Miniplayer"]');
    const cs = reg ? getComputedStyle(reg) : null;
    const w = document.querySelector('div[data-wfx-player-host]');
    let host = 'absent';
    if (w && w.isConnected) {
      host = w.closest('main') ? 'inline-main' : 'other-connected';
      let n = w;
      while (n) {
        if (n.getAttribute && n.getAttribute('aria-label') === 'Miniplayer') { host = 'mini'; break; }
        n = n.parentElement;
      }
    } else if (w) host = 'limbo';
    D.timeline.push({ t: now(), path: location.pathname, pushN: D.push.length,
      mini: cs ? cs.opacity + '/' + cs.pointerEvents : 'absent', host,
      doc: performance.timeOrigin % 100000 });
    if (D.timeline.length > 600) D.timeline.shift();
  }, 250);
  return true;
}"""

JS_FORENSICS_S3 = r"""() => {
  const D = window.__s3probe;
  if (!D) return { probes: false };
  const out = { path: location.pathname, push: D.push.slice(-6), clicks: (D.clicks || []).slice(-10) };
  const b = document.querySelector('button[aria-label="Expand miniplayer"]');
  out.buttonPresent = !!b;
  if (b) {
    const r = b.getBoundingClientRect();
    out.bbox = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    const cs = getComputedStyle(b);
    out.btn = { opacity: cs.opacity, pe: cs.pointerEvents, vis: cs.visibility };
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.top = top ? (top.getAttribute && top.getAttribute('aria-label')) || top.tagName : null;
    out.topInBtn = top ? (top === b || b.contains(top)) : false;
  }
  const reg = document.querySelector('[aria-label="Miniplayer"]');
  if (reg) {
    const rcs = getComputedStyle(reg);
    out.region = { opacity: rcs.opacity, pe: rcs.pointerEvents };
  } else out.region = null;
  const w = document.querySelector('div[data-wfx-player-host]');
  out.wrapper = w ? (w.isConnected ? 'connected' : 'limbo') : 'absent';
  out.pending = D.fetches.filter((f) => !f.settled).slice(-8);
  return out;
}"""


def install_s3_probes(page):
    try:
        page.evaluate(JS_PROBES_S3)
    except Exception as e:  # noqa: BLE001
        log(f"  [S3-probes] install failed: {type(e).__name__}")


def s3_timeline_lines(page) -> list[str]:
    try:
        tl = page.evaluate("() => window.__s3probe ? window.__s3probe.timeline : []")
    except Exception:  # noqa: BLE001
        return []
    lines, prev = [], None
    for s in tl:
        cur = (s["path"], s["pushN"], s["mini"], s["host"], s.get("doc"))
        if cur != prev:
            lines.append(f"t={s['t']}ms path={s['path']} pushN={s['pushN']} "
                         f"mini={s['mini']} host={s['host']} doc={s.get('doc')}")
            prev = cur
    return lines


def dump_s3_evidence(page) -> str:
    """Print + return a compact evidence signature for the S3 verdict."""
    try:
        fore = page.evaluate(JS_FORENSICS_S3)
    except Exception as e:  # noqa: BLE001
        log(f"  [S3-evidence] forensics failed: {type(e).__name__}")
        return "forensics-unavailable"
    log(f"  [S3-evidence] forensics: {json.dumps(fore)[:1200]}")
    lines = s3_timeline_lines(page)
    for line in lines[-12:]:
        log(f"  [S3-timeline] {line}")
    pushes = fore.get("push") or []
    watch_pushes = [p for p in pushes if "/watch/" in p.get("url", "")]
    if watch_pushes:
        sig = "PUSH-REACHED-NEXT(" + str(len(watch_pushes)) + ")"
    elif fore.get("probes") is False:
        sig = "NO-PROBES"
    else:
        sig = "NO-PUSHSTATE"
    if fore.get("buttonPresent") is False:
        sig += "+BUTTON-UNMOUNTED"
    elif fore.get("topInBtn") is False:
        sig += "+HIT-BLOCKED:" + str(fore.get("top"))
    if fore.get("region") and fore["region"].get("pe") == "none":
        sig += "+REGION-PE-NONE"
    return sig


def click_client_nav(page, sel, want, label="nav",
                     attempts=3, poll_s=4.0, hover_first=False):
    """Click and wait for the SPA URL change; up to `attempts` tries.

    `want` is ("path", "/") for an exact pathname or ("path-prefix",
    "/watch/") for a prefix — compared on the PARSED pathname. A raw origin
    prefix like BASE + "/" matches /watch/ too (the run-2 chaos bug) —
    never compare raw URL prefixes for the home target.

    Returns (ok, why) — why carries the attempt count so click-flakes are
    recorded, never swallowed."""
    from urllib.parse import urlparse

    def url_ok() -> bool:
        # WFX2-EXPAND-DIAG-1 correction: judge on PAGE-SIDE truth first.
        # page.url lagged a same-document pushState nav by >=15s on prod
        # (the S3 evidence bundle caught it): the poll declared "no nav"
        # while location.pathname had committed and held. Fallback to the
        # tracked URL only when the page cannot be evaluated.
        try:
            path = page.evaluate("() => location.pathname")
        except Exception:  # noqa: BLE001
            path = urlparse(page.url).path
        kind, want_path = want
        if kind == "path":
            return path.rstrip("/") == want_path.rstrip("/")
        return path.startswith(want_path)

    notes = []
    for i in range(1, attempts + 1):
        loc = page.locator(sel).first
        try:
            loc.wait_for(state="attached", timeout=8000)
        except Exception as e:  # noqa: BLE001
            return False, f"{label}: selector never attached ({type(e).__name__})"
        if hover_first:
            try:
                loc.hover(timeout=3000)
                page.wait_for_timeout(250)
            except Exception:  # noqa: BLE001
                pass
        try:
            loc.click(timeout=5000)
        except Exception as e:  # noqa: BLE001
            notes.append(f"try{i}: click {type(e).__name__}")
            continue
        t0 = time.monotonic()
        while time.monotonic() - t0 < poll_s:
            if url_ok():
                why = f"{label}: navigated on attempt {i}"
                if i > 1:
                    why += f" (FLAKE-CLASS: tries={notes})"
                return True, why
            time.sleep(0.15)
        notes.append(f"try{i}: no nav (at {urlparse(page.url).path})")
        page.wait_for_timeout(400)
    return False, f"{label}: url never reached {want} ({'; '.join(notes)})"


def main() -> int:
    log(f"player-host-proof @ {BASE}  (viewport={VIEWPORT['width']}x{VIEWPORT['height']})")
    video, discovery = discover_video()
    log(f"discovery: {discovery}")
    if video is None:
        log("VERDICT: BLOCKED-FEED — nothing to attach; honest completion")
        return 0
    vid = video["id"]
    log(f"attach target: {vid} — {video.get('title', '')[:60]}")

    results: list[tuple[str, str, str]] = []
    console_errors: list[str] = []
    overflow: int | None = None
    tag = f"wfx2-host-proof-{int(time.time())}"

    def record(step, ok, why):
        results.append((step, "PASS" if ok else "FAIL", why))
        log(f"  [{step}] {'PASS' if ok else 'FAIL'} — {why}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=HEADLESS)
            ctx = browser.new_context(viewport=VIEWPORT)
            page = ctx.new_page()
            page.on("console", lambda m: console_errors.append(m.text)
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

            # ---- S1 attach-inline ------------------------------------------
            page.goto(f"{BASE}/watch/{vid}", wait_until="domcontentloaded", timeout=30_000)
            st = wait_wrapper(page)
            if not (st.get("exists") and st.get("connected")):
                record("S1-ATTACH-INLINE", False, f"wrapper never connected: {st}")
                log("cannot continue the matrix without the wrapper")
                log("verdicts: " + json.dumps({s: v for s, v, _ in results}))
                return 1
            tag_wrapper(page, tag)
            overflow = page.evaluate(
                "document.documentElement.scrollWidth - document.documentElement.clientWidth")
            st = page.evaluate(JS_WRAPPER_STATE, tag)
            mini = page.evaluate(JS_MINI_VISIBLE)
            record("S1-ATTACH-INLINE",
                   st["host"] != "mini" and st["tagged"] and not mini["visible"],
                   f"host={st['host']} tagged={st['tagged']} miniVisible={mini['visible']} "
                   f"overflow={overflow}px")

            # ---- S2 leave -> mini ------------------------------------------
            ok, why = click_client_nav(page, HOME_LINK, ("path", "/"), label="logo-click")
            if not ok:
                record("S2-LEAVE-MINI", False, why)
            else:
                settle(page)
                st = page.evaluate(JS_WRAPPER_STATE, tag)
                mini = page.evaluate(JS_MINI_VISIBLE)
                record("S2-LEAVE-MINI",
                       st.get("exists") and st.get("connected") and st.get("host") == "mini"
                       and st.get("tagged") and mini.get("visible"),
                       f"{why} | host={st.get('host')} tagged={st.get('tagged')} "
                       f"miniVisible={mini.get('visible')}")

            # ---- S3 expand -> inline ----------------------------------------
            # The expand transition can be SLOW (measured: a dev-mode route
            # transition landed ~14s after the click — the earlier 4s poll
            # misclassified it). One confident click, a 20s poll, then judge.
            mini = page.evaluate(JS_MINI_VISIBLE)
            if not mini.get("visible"):
                record("S3-EXPAND-INLINE", False,
                       f"precondition: mini not visible on {page.url} ({mini})")
            else:
                install_s3_probes(page)
                s3_navs: list[tuple[str, str]] = []
                def _on_nav(f):
                    try:
                        if f.parent_frame is None:
                            s3_navs.append(("main", f.url))
                    except Exception:
                        pass
                page.on("framenavigated", _on_nav)
                ok, why = click_client_nav(page, EXPAND_BTN, ("path-prefix", "/watch/"),
                                           label="expand-click", hover_first=True,
                                           attempts=3, poll_s=15.0)
                sig = dump_s3_evidence(page)
                log(f"  [S3-cdp] main-frame navigations during S3: "
                    f"{json.dumps(s3_navs[:12])[:600]}")
                log(f"  [S3-views] playwright-url={page.url} "
                    f"page-side-href={page.evaluate('() => location.href')}")
                if not ok:
                    record("S3-EXPAND-INLINE", False, f"{why} | diag-sig={sig}")
                else:
                    settle(page)
                    st = page.evaluate(JS_WRAPPER_STATE, tag)
                    mini = page.evaluate(JS_MINI_VISIBLE)
                    record("S3-EXPAND-INLINE",
                           st.get("connected") and st.get("host") != "mini"
                           and st.get("tagged") and not mini.get("visible"),
                           f"{why} | host={st.get('host')} tagged={st.get('tagged')} "
                           f"miniVisible={mini.get('visible')}")

            # ---- S4 takeover (watch -> watch, no mini flash) ----------------
            # page-truth precondition (WFX2-EXPAND-DIAG-1: page.url can be
            # stale behind a same-document nav — judge location.pathname).
            try:
                s4_path = page.evaluate("() => location.pathname")
            except Exception:  # noqa: BLE001
                from urllib.parse import urlparse as _up3
                s4_path = _up3(page.url).path
            if not s4_path.startswith("/watch/"):
                # sequencing recovery (recorded): a fresh watch load re-creates
                # the wrapper — re-tag the (new) node; the takeover law is
                # about watch->watch nav, independent of how we got here.
                log("  [S4] recovery: not on /watch — fresh goto + re-tag")
                page.goto(f"{BASE}/watch/{vid}", wait_until="domcontentloaded",
                          timeout=30_000)
                wait_wrapper(page)
                tag_wrapper(page, tag)
            page.evaluate(JS_SCROLL_ALL_TOP)
            settle(page, 400)
            target = None
            t0 = time.monotonic()
            while time.monotonic() - t0 < 15.0 and target is None:
                hrefs = page.evaluate(JS_REAL_WATCH_ANCHORS, vid)
                if hrefs:
                    target = hrefs[0]
                else:
                    time.sleep(0.5)
            if not target:
                record("S4-TAKEOVER", False,
                       "[SKIP-CLASS] no real related-rail /watch anchor rendered in 15s "
                       "(the rail's fetch state is its own surface; not a host-law break)")
            else:
                page.evaluate(
                    """(sel) => { window.__wfx2flash = { n: 0, on: false };
                      const r = document.querySelector(sel);
                      if (!r) return;
                      const mo = new MutationObserver(() => {
                        const cs = getComputedStyle(r);
                        if (cs.opacity === '1' && cs.pointerEvents !== 'none')
                          window.__wfx2flash = { n: window.__wfx2flash.n + 1, on: true };
                      });
                      mo.observe(r, { attributes: true, attributeFilter: ['class'] });
                      window.__wfx2flashObs = mo; }""",
                    MINI_REGION)
                # The feed/rail re-renders (anchors move/vanish between the
                # discovery evaluate and the click) — click a REAL locator in
                # one quick pass, not a href-string locator built from a
                # stale snapshot.
                from urllib.parse import urlparse as _up
                ok, why = False, "no real related anchor clickable"
                for attempt in range(3):
                    clicked = False
                    try:
                        for a in page.locator('a[href^="/watch/"]').all()[:12]:
                            try:
                                href = a.get_attribute("href") or ""
                                box = a.bounding_box()
                                if not box or box["height"] <= 10 or box["width"] <= 10:
                                    continue
                                if href.rstrip() == f"/watch/{vid}":
                                    continue
                                a.click(timeout=3000)
                                clicked = True
                                break
                            except Exception:  # noqa: BLE001
                                continue
                    except Exception:  # noqa: BLE001
                        pass
                    if clicked:
                        t0 = time.monotonic()
                        while time.monotonic() - t0 < 8.0:
                            # WFX2-S4-RES: page-truth first (same discipline as
                            # click_client_nav's url_ok — page.url lags the
                            # same-document takeover nav by >=15s).
                            try:
                                p_now = page.evaluate("() => location.pathname")
                            except Exception:  # noqa: BLE001
                                p_now = _up(page.url).path
                            if p_now.startswith("/watch/") and p_now != f"/watch/{vid}":
                                ok = True
                                why = f"related-click: navigated on attempt {attempt + 1}"
                                break
                            time.sleep(0.15)
                        if ok:
                            break
                    page.wait_for_timeout(600)
                settle(page, 1200)
                flash = page.evaluate("() => window.__wfx2flash ?? { n: -1, on: false }")
                st = page.evaluate(JS_WRAPPER_STATE, tag)
                mini = page.evaluate(JS_MINI_VISIBLE)
                from urllib.parse import urlparse as _up2
                # WFX2-S4-RES: the final judge is page-truth too (the landed
                # path is what the page committed, not what CDP last synced).
                try:
                    final_path = page.evaluate("() => location.pathname")
                except Exception:  # noqa: BLE001
                    final_path = _up2(page.url).path
                # The LAW is watch->watch takeover (any different real id the
                # rail offered — the rail re-renders between discovery and
                # click, so the specific id is NOT the contract; the host,
                # tag, no-flash and inline state ARE).
                took_over = (final_path.startswith("/watch/")
                             and final_path != f"/watch/{vid}"
                             and final_path != "/watch/")
                record("S4-TAKEOVER",
                       ok and took_over and st.get("host") != "mini"
                       and st.get("tagged") and not mini.get("visible")
                       and not flash.get("on"),
                       f"{why} | landed={final_path} pagepath-ok={took_over} "
                       f"host={st.get('host')} tagged={st.get('tagged')} "
                       f"miniVisible={mini.get('visible')} flash={flash}")

            # ---- S5 scroll-dock ---------------------------------------------
            # URL guard: the dock law only means something ON /watch. If a
            # prior step's navigation left us elsewhere, recover with a fresh
            # goto + re-tag (recorded), like S4's recovery. The dock driver
            # attaches on the remounted page's own schedule (after detail
            # lands); a single scroll can fire before the listener exists —
            # poll FOR ENGAGEMENT (scroll nudges every ~1s), then poll the
            # undock.
            # ---- S5 cont: the URL guard recovery ----------------------------
            if not page.url.startswith(f"{BASE}/watch/"):
                log("  [S5] recovery: not on /watch — fresh goto + re-tag")
                page.goto(f"{BASE}/watch/{vid}", wait_until="domcontentloaded",
                          timeout=30_000)
                wait_wrapper(page)
                tag_wrapper(page, tag)
            page.evaluate(JS_SCROLL_ALL_TOP)
            settle(page, 400)
            docked = False
            dock_note = ""
            t0 = time.monotonic()
            while time.monotonic() - t0 < 10.0:
                page.evaluate(JS_SCROLL_ALL_BOTTOM)
                settle(page, 900)
                st_docked = page.evaluate(JS_WRAPPER_STATE, tag)
                mini_docked = page.evaluate(JS_MINI_VISIBLE)
                if st_docked.get("host") == "mini" and mini_docked.get("visible"):
                    docked = True
                    dock_note = f"docked after {time.monotonic() - t0:.1f}s of nudges"
                    break
            if not docked:
                st_docked = page.evaluate(JS_WRAPPER_STATE, tag)
                mini_docked = page.evaluate(JS_MINI_VISIBLE)
            page.evaluate(JS_SCROLL_ALL_TOP)
            undocked = False
            t0 = time.monotonic()
            while time.monotonic() - t0 < 8.0:
                settle(page, 700)
                st_undocked = page.evaluate(JS_WRAPPER_STATE, tag)
                mini_undocked = page.evaluate(JS_MINI_VISIBLE)
                if st_undocked.get("host") != "mini" and not mini_undocked.get("visible"):
                    undocked = True
                    break
            if not undocked:
                st_undocked = page.evaluate(JS_WRAPPER_STATE, tag)
                mini_undocked = page.evaluate(JS_MINI_VISIBLE)
            record("S5-SCROLL-DOCK",
                   page.url.startswith(f"{BASE}/watch/") and docked and undocked
                   and st_docked.get("tagged") and st_undocked.get("tagged"),
                   f"{dock_note} | docked host={st_docked.get('host')} "
                   f"miniVisible={mini_docked.get('visible')} | undocked: "
                   f"host={st_undocked.get('host')} miniVisible={mini_undocked.get('visible')} "
                   f"| url={page.url}")

            # ---- S6 close-destroy + reattach-same-node ----------------------
            page.evaluate(JS_SCROLL_ALL_TOP)
            settle(page, 500)
            ok, why = click_client_nav(page, HOME_LINK, ("path", "/"), label="logo-click-2")
            if not ok:
                record("S6-CLOSE-DESTROY", False, why)
            else:
                settle(page)
                try:
                    page.locator(MINI_REGION).first.hover(timeout=4000)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    page.locator(CLOSE_BTN).first.click(timeout=5000)
                except Exception as e:  # noqa: BLE001
                    record("S6-CLOSE-DESTROY", False,
                           f"close button unclickable: {type(e).__name__}")
                else:
                    settle(page, 900)
                    st = page.evaluate(JS_WRAPPER_STATE, tag)
                    mini = page.evaluate(JS_MINI_VISIBLE)
                    destroyed = (not st.get("exists")) or (not st.get("connected"))
                    record("S6-CLOSE-DESTROY",
                           destroyed and not mini.get("present"),
                           f"after close: wrapper={st} miniPresent={mini.get('present')}")
                    # the next attach must return THE SAME tagged node to
                    # service (the session-singleton frame law) — click a REAL
                    # home card anchor (ghost zero-bbox anchors are designed
                    # elements, observed on prod, and must not drive this).
                    # The feed re-renders (anchors move/vanish), so resolve and
                    # click in ONE quick pass over live locators.
                    ok2, why2 = False, "no real /watch anchor found"
                    for attempt in range(3):
                        # WFX2-EXPAND-DIAG-1 presence-wait: the home feed's
                        # /watch/ anchors materialize 4.5-7s after the
                        # client-nav home on prod (measured in the post-close
                        # state probe: 0 anchors at close+1.5s, 48 at +4.5s).
                        # The old 3-quick-pass scan (~2-5s total) sat entirely
                        # inside that empty window -> 2/2 "no real anchor
                        # navigated" FAILs that were NOT host-law breaks (the
                        # same-node reattach law was never reached). Poll for
                        # PRESENCE first — same discipline as S4's 15s rail
                        # budget and S5's engagement polling.
                        wait_budget = 12000 if attempt == 0 else 3000
                        try:
                            page.wait_for_selector('a[href^="/watch/"]',
                                                   state="attached",
                                                   timeout=wait_budget)
                        except Exception:  # noqa: BLE001
                            pass
                        anchors = page.locator('a[href^="/watch/"]')
                        clicked = False
                        try:
                            for a in anchors.all()[:12]:
                                try:
                                    box = a.bounding_box()
                                    if not box or box["height"] <= 10 or box["width"] <= 10:
                                        continue
                                    a.click(timeout=3000)
                                    clicked = True
                                    break
                                except Exception:  # noqa: BLE001
                                    continue
                        except Exception:  # noqa: BLE001
                            pass
                        if clicked:
                            t0 = time.monotonic()
                            while time.monotonic() - t0 < 6.0:
                                if page.url.startswith(f"{BASE}/watch/"):
                                    ok2 = True
                                    why2 = (f"home-card-click: navigated on attempt "
                                            f"{attempt + 1}")
                                    break
                                time.sleep(0.15)
                            if ok2:
                                break
                        page.wait_for_timeout(600)
                    if not ok2:
                        why2 = (f"home-card-click: no real anchor navigated "
                                f"(3 passes over live locators)")
                    st2 = wait_wrapper(page)
                    record("S6-REATTACH-SAME-NODE",
                           ok2 and st2.get("connected")
                           and st2.get("actualTag") == tag,
                           f"{why2} | connected={st2.get('connected')} "
                           f"sameTag={st2.get('actualTag') == tag} "
                           f"childCount={st2.get('childCount')}")

            browser.close()
    except Exception as e:  # noqa: BLE001
        log(f"INSTRUMENT ERROR: {type(e).__name__}: {e}")
        log(traceback.format_exc(limit=5))
        return 2

    log("")
    log("=== SUMMARY ===")
    broken = 0
    for step, verdict, why in results:
        log(f"  {step:<24} {verdict:<5} {why[:110]}")
        if verdict == "FAIL":
            broken += 1
    if console_errors:
        log(f"console/pageerror captured: {len(console_errors)} (first 3):")
        for c in console_errors[:3]:
            log(f"    {c[:140]}")
    if overflow not in (0, None):
        log(f"  OVERFLOW LAW FAIL: {overflow}px")
    if broken:
        log(f"EXIT 1 — {broken} step(s) BROKE the survival-matrix law")
        return 1
    log("EXIT 0 — the wrapper-never-unmounts law held on every runnable step")
    return 0


if __name__ == "__main__":
    sys.exit(main())

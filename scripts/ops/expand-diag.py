#!/bin/sh
''':'
exec /home/z/.venv/bin/python "$0" "$@"
'''
"""expand-diag.py — the mini Expand dead-button MECHANISM diagnosis (WFX2-EXPAND-DIAG-1).

HOST-1 caught: on PROD, the mini's Expand button does not navigate on
non-watch routes (trusted clicks proven at the button, 3 clicks / ~45s,
URL never became /watch/<id>, no interceptor / server-latency signature;
mechanism UNPINNED — product fix FROZEN pending root cause). This
instrument hunts the mechanism. It is a DIAGNOSIS, not a law: it never
asserts product correctness — it pins WHICH mechanism class swallows the
navigation, with page-truth evidence, and exits 0 when a class is pinned.

Method (zero product changes — everything is page-side probing):
  1. discover the video dynamically (feed -> search-compose; zero hardcoded ids)
  2. goto /watch/<vid>, wait for the persistent wrapper, tag it
  3. client-nav home via the logo (the HOST-1 S2 arm), verify the mini
     region is visible (precondition)
  4. install probes (page.evaluate, BEFORE any expand interaction):
       - history.pushState/replaceState spies  (Next App Router commits a
         client nav via the native history API — a nav that reaches commit
         MUST be visible here; url + ms + top stack frames recorded)
       - window.fetch spy (every request: start ms, url, settled?, status;
         _rsc-marked requests flagged — RSC payload fetches are the App
         Router's nav pipeline traffic; an _rsc fetch that STARTS and never
         settles is the parked-navigation signature)
       - document-level click census: CAPTURE listener at document (proves
         the trusted click + names the target), BUBBLE listeners at
         documentElement, document and window (if the event bubbles to
         document, it necessarily passed React's delegated root container —
         its synthetic onClick then RAN; a missing document-bubble means
         propagation was stopped below document and the census localizes
         where)
       - window error + unhandledrejection capture (the expandListener
         throw hypothesis — an exception in onExpand before router.push)
  5. click Expand (trusted Playwright click, hover-first, ONE confident
     click), poll 15s sampling URL / pushState / rsc-pending / errors
  6. CONTROL ARM (the differential): click the logo (a nav that landed
     moments earlier in step 3) —
       - control LANDS  -> the router pipeline is alive; the drop is
         EXPAND-SPECIFIC (looked at with the fetch census + bubble census)
       - control LANDS NOT -> the whole router is parked: PARKED-ROUTER
  7. verdict classes (pinned mechanism, evidence lines printed):
       COMMIT-HELD         pushState fired for /watch/<vid> and URL held
       COMMIT-ROLLED-BACK  pushState fired but URL left /watch/<vid>
       STOPPED-BELOW-DOC   document-bubble absent -> propagation killed
                           between the button and document (census shows where)
       EXCEPTION           window error / unhandledrejection during the window
       PARKED-RSC          no commit, an _rsc fetch started pre/at click and
                           never settled inside the poll window
       EXPAND-SPECIFIC-DROP no commit, no error, document-bubble PRESENT
                           (onClick ran), control nav LANDS -> the push was
                           dropped inside the router pre-commit
       PARKED-ROUTER       no commit AND the control nav also fails to land
       UNPINNED            none of the above signatures (honest — recorded)
  8. final census dump: every fetch still unsettled (age ms) + the pushState
     log + the error log — the operator-readable evidence block.

URLLAG dual-truth evidence (WFX2-URLLAG-2):
  The window-14 audit cleared expand-diag's two page.url PRECONDITION judges
  (logo-nav fresh-mount class, 4/4 historical PASS) but did not classify the
  three expand_onwatch()-mediated judge sites (single-arm COMMIT-ROLLED-BACK
  discriminator; replica-arm post-click poll + final judge) — and those judge
  the EXPAND NAV class, the exact class S3-RES caught lying on page.url for
  >=15s. Historical evidence is contradictory (S3-RES saw the lag; expand-diag
  itself saw 4/4 fresh COMMIT-HELD). Evidence-first: the judges stay on
  page.url unchanged; every judge instant ALSO samples the document truth
  (location.pathname) and records divergence + persistence. A measured
  divergence at a judge instant = the S3-RES artifact class acting HERE and
  any correction becomes evidence-backed; zero divergences across arms and
  stations closes the residual benign-WITH-EVIDENCE instead of benign-by-
  assumption.

Env: WEBFLIX_BASE_URL (default http://localhost:3000),
     EXPAND_HEADLESS (default 1), EXPAND_VIEWPORT (default 1440x900),
     EXPAND_POLL_S (default 15), EXPAND_ROUNDS (default 2 — the flake class
     is first-click; round 2 measures attempt-2 behavior on a fresh session),
     EXPAND_REPLICA (default 0; 1 = run the REPLICA arm — the original
     HOST-1 S3 cadence (wait 8s / hover 3s+250ms / click 5s / poll 15s,
     attempts=3) instrumented with what the original cannot see: a 250ms
     state timeline (URL / pushState count / mini opacity+pointerEvents /
     wrapper host) and click-TimeoutError forensics (button presence, bbox,
     computed style, elementFromPoint hit-test at center, region style,
     wrapper state). Differential evidence: same-window single-arm COMMIT
     vs replica-arm FAIL = the mechanism is cadence/state-coupled, not
     station-dead.
"""

import json
import os
import sys
import time
import urllib.request
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ.get("WEBFLIX_BASE_URL", "http://localhost:3000").rstrip("/")
HEADLESS = os.environ.get("EXPAND_HEADLESS", "1") != "0"
_vw, _vh = (os.environ.get("EXPAND_VIEWPORT", "1440x900").split("x") + ["900"])[:2]
VIEWPORT = {"width": int(_vw), "height": int(_vh)}
POLL_S = float(os.environ.get("EXPAND_POLL_S", "15"))
ROUNDS = int(os.environ.get("EXPAND_ROUNDS", "2"))

WRAPPER_SEL = "div[data-wfx-player-host]"
MINI_REGION = '[role="region"][aria-label="Miniplayer"]'
EXPAND_BTN = 'button[aria-label="Expand miniplayer"]'
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


# ---- the probe bundle (installed page-side before the subject click) ----

JS_PROBES = r"""() => {
  if (window.__wfxDiag) return window.__wfxDiag.summary();
  const D = window.__wfxDiag = {
    t0: performance.now(),
    push: [],            // {ms, url, via}
    fetches: [],         // {ms, url, rsc, settled, status, endMs}
    clicks: [],          // {ms, phase, target, trusted, stopped?}
    errors: [],          // {ms, kind, text}
  };
  const now = () => Math.round(performance.now() - D.t0);
  // -- history spies (Next App Router commits client navs via these) --
  for (const name of ['pushState', 'replaceState']) {
    const orig = history[name].bind(history);
    history[name] = function (state, title, url) {
      let via = '?';
      try { via = (new Error().stack || '').split('\n')[2]?.trim().slice(0, 160) || '?'; } catch {}
      D.push.push({ ms: now(), url: String(url), via, kind: name });
      return orig(state, title, url);
    };
  }
  // -- fetch spy --
  const of = window.fetch;
  window.fetch = function (...args) {
    const url = String((args[0] && args[0].url) || args[0] || '');
    const rec = { ms: now(), url: url.slice(0, 220), rsc: url.includes('_rsc'),
                  settled: false, status: null, endMs: null };
    if (D.fetches.length < 400) D.fetches.push(rec);
    return of.apply(this, args).then(
      (res) => { rec.settled = true; rec.status = res.status; rec.endMs = now(); return res; },
      (err) => { rec.settled = true; rec.status = 'ERR:' + (err && err.name); rec.endMs = now(); throw err; });
  };
  // -- click census: capture at document, bubble at html/document/window --
  const label = (n) => {
    let el = n;
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      const a = el.getAttribute && el.getAttribute('aria-label');
      if (a) return a;
    }
    return n && n.tagName ? n.tagName.toLowerCase() : String(n);
  };
  document.addEventListener('click', (e) => {
    D.clicks.push({ ms: now(), phase: 'CAPTURE-doc', target: label(e.target),
                    trusted: e.isTrusted, defaultPrevented: e.defaultPrevented });
  }, true);
  for (const [nm, el, opts] of [
    ['BUBBLE-html', document.documentElement, false],
    ['BUBBLE-doc', document, false],
    ['BUBBLE-win', window, false],
  ]) {
    el.addEventListener('click', (e) => {
      D.clicks.push({ ms: now(), phase: nm, target: label(e.target),
                      trusted: e.isTrusted, defaultPrevented: e.defaultPrevented });
    }, opts);
  }
  window.addEventListener('error', (e) => {
    D.errors.push({ ms: now(), kind: 'error', text: String(e.message).slice(0, 200) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    D.errors.push({ ms: now(), kind: 'rejection', text: String(e.reason).slice(0, 200) });
  });
  D.summary = () => ({
    push: D.push.length, fetches: D.fetches.length,
    clicks: D.clicks.length, errors: D.errors.length,
  });
  // -- the 250ms state timeline (replica arm's dense sampler) --
  D.timeline = [];
  D.sampler = setInterval(() => {
    const reg = document.querySelector('[aria-label="Miniplayer"]');
    const cs = reg ? getComputedStyle(reg) : null;
    const w = document.querySelector('div[data-wfx-player-host]');
    let host = 'absent';
    if (w && w.isConnected) {
      host = 'other-connected';
      let n = w;
      while (n) {
        if (n.getAttribute && n.getAttribute('aria-label') === 'Miniplayer') { host = 'mini'; break; }
        n = n.parentElement;
      }
    } else if (w) host = 'limbo';
    D.timeline.push({ t: Math.round(performance.now() - D.t0),
      path: location.pathname, pushN: D.push.length,
      mini: cs ? cs.opacity + '/' + cs.pointerEvents : 'absent', host });
    if (D.timeline.length > 600) D.timeline.shift();
  }, 250);
  return D.summary();
}"""

JS_FORENSICS = r"""() => {
  const out = {};
  const b = document.querySelector('button[aria-label="Expand miniplayer"]');
  out.buttonPresent = !!b;
  if (b) {
    const r = b.getBoundingClientRect();
    out.bbox = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    const cs = getComputedStyle(b);
    out.btnStyle = { opacity: cs.opacity, pe: cs.pointerEvents,
                     vis: cs.visibility, disp: cs.display };
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.topAtCenter = top ? (top.getAttribute && top.getAttribute('aria-label')) || top.tagName : null;
    out.topInButton = top ? (top === b || b.contains(top)) : false;
  }
  const reg = document.querySelector('[aria-label="Miniplayer"]');
  if (reg) {
    const rcs = getComputedStyle(reg);
    out.region = { opacity: rcs.opacity, pe: rcs.pointerEvents };
  } else out.region = null;
  const w = document.querySelector('div[data-wfx-player-host]');
  out.wrapper = w ? (w.isConnected ? 'connected' : 'limbo') : 'absent';
  out.path = location.pathname;
  out.pushN = window.__wfxDiag ? window.__wfxDiag.push.length : -1;
  const D = window.__wfxDiag;
  out.lastPush = D && D.push.length ? D.push[D.push.length - 1] : null;
  return out;
}"""


def timeline_changes(page) -> list[str]:
    """Dedupe the sampler timeline into transition lines."""
    tl = page.evaluate("() => window.__wfxDiag ? window.__wfxDiag.timeline : []")
    lines: list[str] = []
    prev = None
    for s in tl:
        cur = (s["path"], s["pushN"], s["mini"], s["host"])
        if cur != prev:
            lines.append(f"t={s['t']}ms path={s['path']} pushN={s['pushN']} "
                         f"mini={s['mini']} host={s['host']}")
            prev = cur
    return lines

JS_CENSUS = r"""() => {
  const D = window.__wfxDiag;
  const t = performance.now() - D.t0;
  const pending = D.fetches.filter((f) => !f.settled)
    .slice(-12)
    .map((f) => ({ ageMs: Math.round(t - f.ms), rsc: f.rsc, url: f.url }));
  return { nowMs: Math.round(t), push: D.push, pending,
           clicks: D.clicks.slice(-24), errors: D.errors };
}"""


# ---- WFX2-URLLAG-2: dual-truth evidence at judge instants ------------------
# page.url judges keep their semantics; the same-instant document truth is
# sampled alongside and any divergence (with persistence) is recorded as
# evidence. Values only; the verdict logic is untouched pending that data.
URLLAG = {"samples": 0, "divergences": 0, "open_since": None, "events": []}


def urllag_reset() -> None:
    URLLAG["samples"] = 0
    URLLAG["divergences"] = 0
    URLLAG["open_since"] = None
    URLLAG["events"] = []


def doc_path(page) -> str:
    try:
        return page.evaluate("() => location.pathname")
    except Exception:  # noqa: BLE001
        return "evaluate-failed"


def urllag_sample(page, where: str) -> None:
    """Dual-truth sample for the page.url poll loops (precondition judges).
    Records divergence on first sight + convergence time; the loop's own
    break condition is untouched."""
    try:
        pw_path = urlparse(page.url).path
        dp = page.evaluate("() => location.pathname")
    except Exception:  # noqa: BLE001
        return
    URLLAG["samples"] += 1
    if dp != pw_path:
        if URLLAG["open_since"] is None:
            URLLAG["open_since"] = time.monotonic()
            URLLAG["divergences"] += 1
            URLLAG["events"].append({"where": where, "pw": pw_path, "doc": dp})
            log(f"  [urllag] {where} DIVERGENCE: page.url={pw_path!r} "
                f"document={dp!r} (stale-source class at a judge)")
    elif URLLAG["open_since"] is not None:
        held = round(time.monotonic() - URLLAG["open_since"], 2)
        log(f"  [urllag] {where} converged after {held}s (page.url caught up)")
        URLLAG["open_since"] = None


def urllag_summary(where: str) -> None:
    if URLLAG["open_since"] is not None:
        held = round(time.monotonic() - URLLAG["open_since"], 2)
        log(f"  [urllag] {where} STILL-DIVERGED at round end (open {held}s)")
    log(f"  [urllag] {where} round evidence: samples={URLLAG['samples']} "
        f"divergences={URLLAG['divergences']}")


def expand_onwatch(page) -> bool:
    """Judge on-watch from page.url — dual-truth instrumented (WFX2-URLLAG-2).
    Judge semantics UNCHANGED (page.url); the same-instant document truth is
    sampled and any divergence is recorded as evidence."""
    pw_path = urlparse(page.url).path
    try:
        dp = page.evaluate("() => location.pathname")
    except Exception:  # noqa: BLE001
        dp = None
    if dp is not None:
        URLLAG["samples"] += 1
        if dp != pw_path:
            if URLLAG["open_since"] is None:
                URLLAG["open_since"] = time.monotonic()
                URLLAG["divergences"] += 1
            URLLAG["events"].append({"where": "expand_onwatch-judge",
                                     "pw": pw_path, "doc": dp})
            log(f"  [urllag] JUDGE-INSTANT DIVERGENCE: page.url={pw_path!r} "
                f"document={dp!r} (S3-RES artifact class at a judge)")
    return pw_path.startswith("/watch/")


def run_round(pw, round_no: int, vid: str, vid_note: str) -> str:
    """One fresh session round; returns the pinned verdict class."""
    urllag_reset()
    browser = pw.chromium.launch(headless=HEADLESS)
    ctx = browser.new_context(viewport=VIEWPORT)
    page = ctx.new_page()
    console_lines: list[str] = []
    page.on("console", lambda m: console_lines.append(
        f"{m.type}:{m.text[:160]}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: console_lines.append(f"pageerror:{str(e)[:200]}"))
    verdict = "UNPINNED"
    try:
        # -- 1. attach: /watch/<vid> inline --
        page.goto(f"{BASE}/watch/{vid}", wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_selector(WRAPPER_SEL, state="attached", timeout=30_000)
        page.evaluate(
            "(t) => { const e = document.querySelector('div[data-wfx-player-host]');"
            " e.__wfxDiagTag = t; }", f"diag-r{round_no}")
        # -- 2. leave to home (logo) --
        page.locator(HOME_LINK).first.click(timeout=8_000)
        t0 = time.monotonic()
        while time.monotonic() - t0 < 10 and urlparse(page.url).path != "/":
            urllag_sample(page, "precondition-home")
            page.wait_for_timeout(250)
        if urlparse(page.url).path != "/":
            return f"PRECONDITION-FAIL: logo nav never landed (url={page.url} doc={doc_path(page)})"
        page.wait_for_timeout(1_500)
        mini = page.evaluate(
            """() => { const r = document.querySelector('[aria-label="Miniplayer"]');
                 if (!r) return { present: false };
                 const cs = getComputedStyle(r);
                 return { present: true, visible: cs.opacity === '1' &&
                          cs.pointerEvents !== 'none' }; }""")
        if not (mini.get("present") and mini.get("visible")):
            return f"PRECONDITION-FAIL: mini not visible on home ({mini})"
        # -- 3. probes in --
        probes = page.evaluate(JS_PROBES)
        log(f"  probes installed: {probes}")
        # -- 4. the subject click --
        btn = page.locator(EXPAND_BTN).first
        btn.hover(timeout=5_000)
        page.wait_for_timeout(250)
        click_ms = page.evaluate("() => Math.round(performance.now() - window.__wfxDiag.t0)")
        btn.click(timeout=5_000)
        # -- 5. poll --
        push_seen = False
        t0 = time.monotonic()
        while time.monotonic() - t0 < POLL_S:
            st = page.evaluate(JS_CENSUS)
            pushes_to_watch = [p for p in st["push"]
                               if "/watch/" in p["url"] and p["ms"] >= click_ms]
            if pushes_to_watch:
                push_seen = True
                break
            page.wait_for_timeout(250)
        census = page.evaluate(JS_CENSUS)
        rsc_pending = [f for f in census["pending"] if f["rsc"]]
        doc_bubble = [c for c in census["clicks"]
                      if c["phase"] in ("BUBBLE-doc", "BUBBLE-win")
                      and c["ms"] >= click_ms]
        errors = census["errors"]
        if push_seen:
            verdict = ("COMMIT-ROLLED-BACK" if not expand_onwatch(page)
                       else "COMMIT-HELD")
        elif errors:
            verdict = "EXCEPTION"
        elif not doc_bubble:
            verdict = "STOPPED-BELOW-DOC"
        elif rsc_pending:
            verdict = "PARKED-RSC"
        else:
            verdict = "PUSH-DROPPED-PRECOMMIT-CANDIDATE"
        log(f"  subject: url={page.url} doc={doc_path(page)} pushState={census['push']} "
            f"docBubble={'Y' if doc_bubble else 'N'} errors={len(errors)} "
            f"rscPending={len(rsc_pending)}")
        # -- 6. control arm: the logo nav (landed in step 2) --
        if verdict == "PUSH-DROPPED-PRECOMMIT-CANDIDATE":
            c0 = page.evaluate(JS_CENSUS)
            ctl_ms = c0["nowMs"]
            try:
                page.locator(HOME_LINK).first.hover(timeout=4_000)
                page.locator(HOME_LINK).first.click(timeout=5_000)
            except Exception as e:  # noqa: BLE001
                log(f"  control: click threw {type(e).__name__}")
            t0 = time.monotonic()
            landed = False
            while time.monotonic() - t0 < 10:
                if len(page.evaluate(
                        "() => window.__wfxDiag.push")) > len(c0["push"]):
                    landed = True
                    break
                page.wait_for_timeout(250)
            log(f"  control: landed={landed} url={page.url} doc={doc_path(page)}")
            verdict = ("EXPAND-SPECIFIC-DROP" if landed else "PARKED-ROUTER")
        # -- 7. evidence block --
        log(f"  clicks-census: {json.dumps(census['clicks'][-8:])[:400]}")
        if census["pending"]:
            log(f"  unsettled@end: {json.dumps(census['pending'])[:500]}")
        if errors:
            log(f"  errors: {json.dumps(errors)[:300]}")
        noisy = [c for c in console_lines if "hydration" not in c.lower()][:6]
        if noisy:
            log(f"  console: {noisy}")
    finally:
        urllag_summary("single")
        try:
            ctx.close()
            browser.close()
        except Exception:  # noqa: BLE001
            pass
    return verdict


def run_round_replica(pw, round_no: int, vid: str) -> str:
    """The original HOST-1 S3 cadence, instrumented. Reproduces the failure
    (when it reproduces) WITH the state evidence the original lacks."""
    urllag_reset()
    browser = pw.chromium.launch(headless=HEADLESS)
    ctx = browser.new_context(viewport=VIEWPORT)
    page = ctx.new_page()
    console_lines: list[str] = []
    page.on("console", lambda m: console_lines.append(
        f"{m.type}:{m.text[:160]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: console_lines.append(f"pageerror:{str(e)[:200]}"))
    verdict = "UNPINNED"
    notes: list[str] = []
    try:
        # attach + leave — the original's S1/S2 (logo single-click, 10s wait)
        page.goto(f"{BASE}/watch/{vid}", wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_selector(WRAPPER_SEL, state="attached", timeout=30_000)
        page.evaluate(
            "() => { const e = document.querySelector('div[data-wfx-player-host]');"
            " e.__wfxDiagTag = 'replica'; }")
        t0 = time.monotonic()
        page.locator(HOME_LINK).first.click(timeout=8_000)
        while time.monotonic() - t0 < 10 and urlparse(page.url).path != "/":
            urllag_sample(page, "precondition-home")
            page.wait_for_timeout(250)
        if urlparse(page.url).path != "/":
            return f"PRECONDITION-FAIL: logo nav never landed (url={page.url} doc={doc_path(page)})"
        logo_ms = int((time.monotonic() - t0) * 1000)
        page.wait_for_timeout(700)  # the original's settle(page)
        mini = page.evaluate(
            """() => { const r = document.querySelector('[aria-label="Miniplayer"]');
                 if (!r) return { present: false };
                 const cs = getComputedStyle(r);
                 return { present: true, visible: cs.opacity === '1' &&
                          cs.pointerEvents !== 'none' }; }""")
        if not (mini.get("present") and mini.get("visible")):
            return f"PRECONDITION-FAIL: mini not visible on home ({mini})"
        page.evaluate(JS_PROBES)
        log(f"  [replica] logo-land={logo_ms}ms (original poll=4s would call "
            f">4000ms a 'swallow') probes on")
        # -- the original S3 cadence: attempts=3, poll 15s, click 5s --
        commit = False
        for attempt in (1, 2, 3):
            loc = page.locator(EXPAND_BTN).first
            try:
                loc.wait_for(state="attached", timeout=8_000)
            except Exception as e:  # noqa: BLE001
                notes.append(f"try{attempt}: attach {type(e).__name__}")
                continue
            try:
                loc.hover(timeout=3_000)
                page.wait_for_timeout(250)
            except Exception:  # noqa: BLE001
                pass
            try:
                loc.click(timeout=5_000)
            except Exception as e:  # noqa: BLE001
                fore = page.evaluate(JS_FORENSICS)
                notes.append(f"try{attempt}: click {type(e).__name__}")
                log(f"  [try{attempt}] TIMEOUT forensics: {json.dumps(fore)[:420]}")
                continue
            p0 = page.evaluate("() => window.__wfxDiag.push.length")
            t0 = time.monotonic()
            while time.monotonic() - t0 < POLL_S:
                if expand_onwatch(page):
                    commit = True
                    break
                page.wait_for_timeout(250)
            if commit:
                notes.append(f"try{attempt}: nav ok")
                break
            notes.append(f"try{attempt}: no nav (at {urlparse(page.url).path} "
                         f"doc={doc_path(page)})")
        # -- evidence --
        push_log = page.evaluate("() => window.__wfxDiag.push")
        log(f"  notes: {notes}")
        log(f"  pushState log: {json.dumps(push_log)[:420]}")
        for line in timeline_changes(page)[-14:]:
            log(f"  timeline {line}")
        if console_lines:
            log(f"  console-errors: {console_lines[:4]}")
        # -- verdict --
        pushes_to_watch = [p for p in push_log if "/watch/" in p["url"]]
        if commit:
            verdict = "COMMIT-HELD"
        elif pushes_to_watch and not expand_onwatch(page):
            verdict = "COMMIT-ROLLED-BACK"
        elif pushes_to_watch:
            verdict = "COMMIT-HELD-LATE"
        else:
            timeout_notes = [n for n in notes if "TimeoutError" in n]
            fore = page.evaluate(JS_FORENSICS)
            if timeout_notes and fore.get("buttonPresent") is False:
                verdict = "LATE-UNMOUNT-NO-COMMIT"
            elif timeout_notes and fore.get("region") and fore["region"].get("pe") == "none":
                verdict = "MINI-HIDDEN-AT-RETRY"
            elif timeout_notes and fore.get("topInButton") is False:
                verdict = "OVERLAY-AT-RETRY"
            elif timeout_notes:
                verdict = "RETRY-CLICK-BLOCKED"
            else:
                verdict = "PUSH-DROPPED-PRECOMMIT-CANDIDATE"
    finally:
        urllag_summary("replica")
        try:
            ctx.close()
            browser.close()
        except Exception:  # noqa: BLE001
            pass
    return verdict


def main() -> int:
    replica = os.environ.get("EXPAND_REPLICA", "0") == "1"
    log(f"[expand-diag] base={BASE} viewport={VIEWPORT['width']}x{VIEWPORT['height']} "
        f"headless={HEADLESS} poll={POLL_S}s rounds={ROUNDS} mode={'replica' if replica else 'single'}")
    vid_row, note = discover_video()
    if not vid_row:
        log(f"[verdict] INSTRUMENT-BLOCKED: no video discoverable ({note})")
        return 2
    vid = vid_row["id"]
    log(f"[subject] video={vid} (via {note})")
    results = []
    with sync_playwright() as pw:
        for i in range(1, ROUNDS + 1):
            log(f"--- round {i}/{ROUNDS} ---")
            try:
                v = (run_round_replica(pw, i, vid) if replica
                     else run_round(pw, i, vid, note))
            except Exception as e:  # noqa: BLE001
                v = f"INSTRUMENT-ERROR {type(e).__name__}: {e}"
            log(f"  round {i} verdict: {v}")
            results.append(v)
    log("")
    log("[verdict-summary]")
    for i, v in enumerate(results, 1):
        log(f"  round {i}: {v}")
    classes = set(results)
    if any(v.startswith("INSTRUMENT") or v.startswith("PRECONDITION") for v in results):
        return 2
    log("[pinned] " + " / ".join(sorted(classes)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

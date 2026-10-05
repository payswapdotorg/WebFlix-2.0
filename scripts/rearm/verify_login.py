#!/usr/bin/env python3
"""Verify YouTube login state in the live CDP Chrome (:9222, persistent profile).

Read-only: iterates existing context pages, finds (or opens) a youtube.com page,
checks ytcfg.data_.LOGGED_IN / SESSION_INDEX, avatar button presence, and absence
of a "Sign in" link. Does NOT close any pages, does NOT log out/in.
"""
import json
import sys

from playwright.sync_api import sync_playwright

CDP = "http://localhost:9222"
YT = "https://www.youtube.com"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        try:
            ctx = None
            yt_page = None
            for c in browser.contexts:
                ctx = ctx or c  # keep first context as fallback
                for pg in c.pages:
                    if "youtube.com" in (pg.url or ""):
                        yt_page = pg
                        ctx = c
                        break
                if yt_page:
                    break

            if yt_page is None:
                # No youtube tab open: use an existing context (do not create a
                # throwaway one) and open a new tab to youtube.com.
                if ctx is None and browser.contexts:
                    ctx = browser.contexts[0]
                if ctx is None:
                    print("LOGIN_VERIFIED=false")
                    print("detail=no_browser_context")
                    return 2
                yt_page = ctx.new_page()
                yt_page.goto(YT, wait_until="domcontentloaded", timeout=45000)

            url = yt_page.url
            # Reload only if the page predates this check? Keep read-only: no reload.

            cfg = None
            try:
                cfg = yt_page.evaluate(
                    "() => (window.ytcfg && ytcfg.data_) ? "
                    "{li: ytcfg.data_.LOGGED_IN, si: ytcfg.data_.SESSION_INDEX} : null"
                )
            except Exception as e:  # page may be navigating/asleep
                print(f"evaluate_error={type(e).__name__}", file=sys.stderr)
                try:
                    yt_page.wait_for_load_state("domcontentloaded", timeout=20000)
                    cfg = yt_page.evaluate(
                        "() => (window.ytcfg && ytcfg.data_) ? "
                        "{li: ytcfg.data_.LOGGED_IN, si: ytcfg.data_.SESSION_INDEX} : null"
                    )
                except Exception as e2:
                    print(f"evaluate_retry_error={type(e2).__name__}", file=sys.stderr)

            avatar = False
            sign_in_gone = False
            try:
                avatar = yt_page.evaluate(
                    "() => !!document.querySelector("
                    "\"img#avatar-btn, button[aria-label*='Account'], "
                    "button#avatar-btn, ytmasthead button[aria-label*='Account']\")"
                )
            except Exception as e:
                print(f"avatar_probe_error={type(e).__name__}", file=sys.stderr)
            try:
                sign_in_gone = yt_page.evaluate(
                    "() => !document.querySelector("
                    "\"a[href*='ServiceLogin'], button[aria-label*='Sign in']\")"
                )
            except Exception as e:
                print(f"signin_probe_error={type(e).__name__}", file=sys.stderr)

            logged_in = bool(cfg and cfg.get("li"))
            verified = logged_in and (avatar or sign_in_gone)

            print(f"LOGIN_VERIFIED={'true' if verified else 'false'}")
            print(f"page_url={url}")
            print(f"ytcfg={json.dumps(cfg)}")
            print(f"LOGGED_IN={cfg.get('li') if cfg else 'null'}")
            print(f"SESSION_INDEX={cfg.get('si') if cfg else 'null'}")
            print(f"avatar_button={avatar}")
            print(f"sign_in_link_gone={sign_in_gone}")
            return 0 if verified else 1
        finally:
            # connect_over_cdp: disconnect leaves the browser + all pages running.
            browser.close()


if __name__ == "__main__":
    sys.exit(main())

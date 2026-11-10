#!/home/z/.venv/bin/python
"""wfx2-window-open.py — GitHub surface check at window open (WFX2 standing).

Token read order (vault-first — kills the /tmp/ghtk residue class):
  1. GITHUB_PAT env var
  2. /home/z/.secrets/GITHUB_PAT_PRIMARY (vault, 0600)
  3. /tmp/ghtk fallback (legacy extraction pattern)

NOTE (WFX2-ERASURE-13): this tool was wiped from /home/z at the window-15
boundary along with the vault. It is now ALSO version-controlled in the repo
at scripts/ops/window-open.py — the tool-loss class is structurally closed
(git remains the recoverable copy of record).

Checks (read-only):
  0. vault inventory (names-only — the WFX2-ERASURE-13 standing check made
     structural: the vault was wiped twice at window boundaries; a wipe is
     now visible at every window open, before anything else runs)
  0b. working-tree erasure signature (WFX2-SIG-1: the same 10-file
     unstaged-deletion signature has hit three times at window boundaries
     #10/#12/#13 — each occurrence now self-documents its exact file names
     at the moment of detection; the heal is 'git restore', earliest link)
  1. rate limit headroom
  2. Issue #7 + Draft PR #8: comments newer than BASELINE_COMMENT_ID
  3. open issues / open PRs / branches
  4. main head CI check-runs
"""
import json
import os
import subprocess
import sys
import urllib.request

BASE = "https://api.github.com/repos/payswapdotorg/WebFlix-2.0"
BASELINE_COMMENT_ID = 6744593911  # issuecomment-6744593911 on Issue #7
VAULT = "/home/z/.secrets/GITHUB_PAT_PRIMARY"
VAULT_DIR = "/home/z/.secrets"
# Names only — values are never read, logged, or printed here.
EXPECTED_VAULT_FILES = (
    "APIFY_API_KEY", "COMPOSIO_API_KEY", "COMPOSIO_MCP_API_KEY",
    "E2B_API_KEY", "GITHUB_PAT_FALLBACK", "GITHUB_PAT_PRIMARY",
    "NEON_API_KEY_1", "NEON_API_KEY_2", "NEON_API_KEY_3_RATELIMIT_FALLBACK",
    "NEON_API_KEY_4", "OPENROUTER_API_KEY", "VERCEL_TOKEN_FALLBACK",
    "VERCEL_TOKEN_PRIMARY",
)


def read_token():
    if os.environ.get("GITHUB_PAT"):
        return os.environ["GITHUB_PAT"].strip()
    if os.path.exists(VAULT):
        try:
            return open(VAULT).read().strip()
        except Exception:
            pass
    if os.path.exists("/tmp/ghtk"):
        return open("/tmp/ghtk").read().strip()
    return None


def vault_check() -> None:
    """WFX2-ERASURE-13 standing check, made structural: the vault was wiped
    twice at window boundaries (window-12-era and window-15). Names-only
    inventory + mode check; values are never touched."""
    if not os.path.isdir(VAULT_DIR):
        print("[vault] MISSING (entire dir absent) — ERASURE-13 class: "
              "recovery protocol required (conversation context is the "
              "recovery channel of record)")
        return
    dmode = oct(os.stat(VAULT_DIR).st_mode & 0o777)
    present = {n for n in os.listdir(VAULT_DIR)
               if os.path.isfile(os.path.join(VAULT_DIR, n))}
    missing = [n for n in EXPECTED_VAULT_FILES if n not in present]
    bad_mode = [n for n in EXPECTED_VAULT_FILES
                if n in present
                and (os.stat(os.path.join(VAULT_DIR, n)).st_mode & 0o777) != 0o600]
    extras = present - set(EXPECTED_VAULT_FILES) - {"env.sh", "inventory.md"}
    if missing:
        print(f"[vault] INCOMPLETE dir_mode={dmode} missing={missing} "
              f"(names-only; ERASURE-13 class)")
    else:
        print(f"[vault] complete files=13+2 dir_mode={dmode}")
    if bad_mode:
        print(f"[vault] MODE-DEVIATION (expected 0600): {bad_mode}")
    if extras:
        print(f"[vault] unexpected entries (names-only): {sorted(extras)}")


def erasure_check() -> None:
    """WFX2-SIG-1: unstaged/staged deletion signature detection. The same
    10-file upload-lane unstaged deletion has hit three times at window
    boundaries (#10, #12, #13). Names are printed exactly as git sees them
    so every occurrence self-documents the signature; the heal is instant
    (git restore)."""
    try:
        out = subprocess.run(
            ["git", "-C", "/home/z/my-project", "status", "--porcelain"],
            capture_output=True, text=True, timeout=15).stdout
    except Exception as e:  # noqa: BLE001
        print(f"[tree] ERROR {type(e).__name__}: {e}")
        return
    lines = [ln for ln in out.splitlines() if ln.strip()]
    deleted = [ln[3:] for ln in lines if "D" in ln[:2]]
    others = [ln for ln in lines if "D" not in ln[:2]]
    if deleted:
        print(f"[tree] ERASURE-SIGNATURE: {len(deleted)} deletion(s) — "
              f"heal: git restore; names exactly as git sees them:")
        for n in deleted:
            print(f"    D {n}")
    else:
        print("[tree] clean (0 deletions)")
    if others:
        print(f"[tree] other modifications: {len(others)}")
        for n in others[:12]:
            print(f"    {n}")


def req(url, token):
    r = urllib.request.Request(url)
    r.add_header("Authorization", f"Bearer {token}")
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("User-Agent", "wfx2-window-open")
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    token = read_token()
    if not token:
        print("NO-TOKEN (no env, no vault, no /tmp/ghtk)")
        sys.exit(1)
    src = ("env" if os.environ.get("GITHUB_PAT")
           else "vault" if os.path.exists(VAULT) else "tmp")
    print(f"[auth] token source: {src}")

    # 0. vault inventory (standing ERASURE-13 check)
    vault_check()

    # 0b. working-tree erasure signature (standing SIG-1 check)
    erasure_check()

    # 1. rate limit
    rl = req("https://api.github.com/rate_limit", token)
    core = rl["resources"]["core"]
    print(f"[rate] core {core['remaining']}/{core['limit']} (reset {core['reset']})")

    # 2. issue #7 + pr #8 comments after baseline
    for num, label in ((7, "issue#7"), (8, "pr#8")):
        try:
            cs = req(f"{BASE}/issues/{num}/comments?per_page=50", token)
            newer = [c for c in cs if c["id"] > BASELINE_COMMENT_ID]
            print(f"[{label}] total={len(cs)} newer_than_baseline={len(newer)}")
            for c in newer:
                who = c["user"]["login"]
                when = c["created_at"]
                body = c["body"][:300].replace("\n", " ")
                print(f"  NEW {c['id']} {who} {when}: {body}")
        except Exception as e:
            print(f"[{label}] ERROR {e}")

    # 3a. open issues
    try:
        iss = req(f"{BASE}/issues?state=open&per_page=30", token)
        mine = [i for i in iss if "pull_request" not in i]
        print(f"[issues] open={len(mine)}")
        for i in mine:
            print(f"  #{i['number']} {i['state']} {i['title'][:80]}")
    except Exception as e:
        print(f"[issues] ERROR {e}")

    # 3b. open PRs
    try:
        prs = req(f"{BASE}/pulls?state=open&per_page=30", token)
        print(f"[prs] open={len(prs)}")
        for p in prs:
            print(f"  #{p['number']} draft={p['draft']} {p['title'][:80]} head={p['head']['sha'][:7]}")
    except Exception as e:
        print(f"[prs] ERROR {e}")

    # 3c. branches (count + the two architect heads we track)
    try:
        brs = req(f"{BASE}/branches?per_page=100", token)
        print(f"[branches] count={len(brs)}")
        for b in brs:
            if b["name"] in ("main",) or b["name"].startswith("architect/"):
                print(f"  {b['name']} {b['commit']['sha'][:7]}")
    except Exception as e:
        print(f"[branches] ERROR {e}")

    # 4. main head check-runs
    try:
        head = req(f"{BASE}/commits/main", token)
        sha = head["sha"]
        print(f"[main] head={sha[:7]} msg={head['commit']['message'][:60]!r}")
        runs = req(f"{BASE}/commits/{sha}/check-runs?per_page=20", token)
        total = runs.get("total_count", 0)
        print(f"[checks] total={total}")
        for c in runs.get("check_runs", []):
            print(f"  {c['name']}: {c['status']}/{c.get('conclusion')}")
    except Exception as e:
        print(f"[checks] ERROR {e}")


if __name__ == "__main__":
    main()

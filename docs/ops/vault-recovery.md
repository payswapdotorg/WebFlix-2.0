# Vault Recovery Runbook — one-paste re-provisioning

> **Scope.** After a full sandbox reset (repo, deps, DB, vault wiped), this
> runbook restores the operator credential vault **outside the repo** in one
> pass. The vault lives at `/home/z/.secrets/webflix.env` (0700 dir, 0600
> file) and is sourced by `~/.bashrc` / `~/.bash_profile`. Secret values
> never enter any git repository — this file only names the slots.
>
> Last full re-provision: **P56** (all slots live-tested; verdicts in the
> P56 WORKLOG entry).

## 1. The vault skeleton

```bash
mkdir -p /home/z/.secrets && chmod 700 /home/z/.secrets
touch /home/z/.secrets/webflix.env && chmod 600 /home/z/.secrets/webflix.env
```

Slots (all `export`ed; values come from the operator, never from the repo):

| Slot | Owner / consumer | P56 verdict |
| --- | --- | --- |
| `GH_TOKEN_PAYSWAP`, `GH_TOKEN_FALLBACK` | git push/pull (credential store) | live |
| `VERCEL_TOKEN_PAYSWAP`, `VERCEL_TOKEN_BACKUP` | Vercel API (payswaporg account, team `team_4KOoA5CgtYaOF85yFXPeMXLt`) | live |
| `NEON_API_KEY_1..4` | Neon console API | **1 & 2 = full org keys (org-shy-shadow-21570034)** — webflix2-prod = `restless-breeze-74749954`; 3 = personal key, not an org member; 4 = org-scoped read (needs `?org_id=`) |
| `NEON_WEBFLIX2_PROD_URL` / `NEON_WEBFLIX2_PROD_DIRECT` | direct prod DB access (pooled / direct endpoint) | live — 79 NetflixTitle rows verified |
| `OPENROUTER_API_KEY` | LLM lane | stored (P53 verdict stands) |
| `E2B_API_KEY` | netflix-desktop broker (sandbox spawn) | **DEAD — 401 "Invalid auth provider token"** on every variant; needs operator rotation |
| `APIFY_API_KEY` | netflix-desktop broker (harvest) | live (`prestigious_peanut`) |
| `COMPOSIO_MCP_API_KEY`, `COMPOSIO_API_KEY` | MCP/app integrations | stored; API surface still unverifiable from the sandbox (v1 → 410, v3 hosts unreachable) |
| `UPSTASH_REDIS_REST_URL/TOKEN` (+`_ALT`) | distributed rate limiting | **URL still NXDOMAIN** (DoH-proven twice — P53, P56); wired nowhere; prod's own pair untouched |
| `UPSTASH_MCP_URL/EMAIL/API_KEY` | Upstash remote MCP | MCP needs operator OAuth on first browser use; key alone answers 401 |
| `CLOUDFLARE_ACCOUNT_ID/API_TOKEN`, `R2_*` | R2 media storage | S3 keys live (18 buckets, `webflix-media` present); account API token dead (P53) |
| `ALIBABA_BAILIAN_API_KEY` | Model cloud | **DEAD — dashscope 401 invalid_api_key** (also not a dashscope-shaped key) |
| `LIVEKIT_URL/API_KEY/API_SECRET/JWT` | live rooms | **live** (signed ListRooms probe → 200) |
| `RESEND_API_KEY` | email sending | **live but send-only scope** (any other endpoint → 401 restricted_api_key) |
| `HIGGSFIELD_EMAIL/PASSWORD` | Higgsfield CLI auth (`npm i -g @higgsfield/cli` → `higgsfield auth login`) | not exercised in P56 (interactive browser flow) |
| — still owed — | `NETFLIX_EMAIL`/`NETFLIX_PASSWORD` (rotation), `NETFLIX_DESKTOP_URL` gateway host, `TMDB_API_KEY`, viewer-counting decision | open rungs |

## 2. Shell wiring

```bash
cat >> ~/.bashrc <<'EOF'
# WebFlix operator vault
if [ -f /home/z/.secrets/webflix.env ]; then set -a; . /home/z/.secrets/webflix.env; set +a; fi
EOF
cp ~/.bashrc ~/.bash_profile && chmod 600 ~/.bashrc ~/.bash_profile
```

## 3. Git rides the PAT

```bash
printf 'https://payswaporg:%s@github.com\n' "$GH_TOKEN_PAYSWAP" > /home/z/.git-creds
chmod 600 /home/z/.git-creds
git config --global credential.helper "store --file=/home/z/.git-creds"
git config --global user.name  "payswaporg"
git config --global user.email "tetevi@payswap.org"
```

## 4. Broker credentials (gitignored `.env`, never committed)

`mini-services/netflix-desktop/.env` carries `APIFY_API_KEY` (live). The
`E2B_API_KEY` slot waits on the operator's rotation — the broker boots and
every non-sandbox lane works without it; sandbox spawn honestly fails until
a fresh key lands.

## 5. Neon — reaching webflix2-prod by API

The org keys need the org id spelled out:

```
GET https://console.neon.tech/api/v2/projects?org_id=org-shy-shadow-21570034
GET https://console.neon.tech/api/v2/projects/restless-breeze-74749954/connection_uri?branch_id=br-lucky-cherry-b72yomwa&role_name=neondb_owner&database_name=neondb&pooler=true
```

(The `connection_uri` route lives at the **project** level — the branch-level
path 404s. The API host is `console.neon.tech`; `api.neon.tech` does not
resolve. Note this sandbox's DNS allowlist blocks `console.neon.tech`'s A
record — use DoH + `curl --resolve`, or the direct DB URL from the vault.)

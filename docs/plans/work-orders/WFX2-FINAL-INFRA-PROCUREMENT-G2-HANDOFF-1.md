# WFX2 FINAL TL HANDOFF — Infrastructure Procurement, Station Reliability & G2 Playback

**Work-order ID:** `WFX2-FINAL-INFRA-PROCUREMENT-G2-1`  
**Date:** 2026-11-12  
**Pinned repository base:** `main @ 04abd77cad1205223c337e49444ffd2134472d74`  
**Current G2 evidence:** `evidence/wfx2-tiktok-main-interface-reliability/g2/EVIDENCE.md` — terminal classification **BLOCKED — NETWORK**  
**Current G2 tracker:** [Issue #7](https://github.com/payswapdotorg/WebFlix-2.0/issues/7)  
**Prior G2-only draft handoff:** [PR #8](https://github.com/payswapdotorg/WebFlix-2.0/pull/8) — still draft and based on the earlier `e0c8c63` tip  
**Current standing verification:** WFX2-SIG-39 / window 43, commit `04abd77`  
**Status:** final operator-authorized handoff; no implementation or provisioning is claimed by this document.

---

## 0. Operator directive — infrastructure must not be a passive blocker

The operator explicitly authorizes the TL to **discover, provision, configure, use, monitor and tear down appropriate infrastructure** required to complete this work, using the operator's API credentials that are already available to the TL through approved secret stores, environment injection or connected provider accounts.

This standing delegation covers these provider credentials/accounts where available:

- GitHub PAT
- Cloudflare
- Modal
- Neon
- OpenRouter
- E2B
- Vercel
- Apify
- Upstash Redis
- Daytona

**Do not stop and ask the operator to provision a resource that the TL can safely provision using an already-available credential.** Diagnose the real limitation, select the smallest fit-for-purpose resource, provision it, verify it, use it, record the cost and clean it up when finished.

This authorization is not a claim that all ten credentials are currently present in the local vault. The TL must inventory the secure credential sources and validate each available credential without exposing its value. A missing credential is a factual blocker only after checking both the secure local store and the connected provider integration.

### 0.1 Bounded procurement authority

Use the following default purchasing envelope for this work order:

- Prefer free-tier capacity, existing credits and pay-as-you-go resources that can be stopped or deleted.
- Maximum aggregate **new billed spend: USD 25** across all providers for this work order.
- Maximum planned cost for any one disposable validation experiment: **USD 5**.
- No annual plans, reserved capacity, committed spend, contracts, card additions, auto-renewing subscriptions, or idle always-on compute.
- Any persistent service must scale to zero or have a documented monthly ceiling of **USD 5/month**. Set provider-level budgets/alerts and resource TTLs wherever supported.
- Count usage of paid credits and shared quotas in the resource ledger even when the immediate invoice is zero. Never burn credits without checking the account's existing usage and limits.
- Stop before exceeding the envelope. Record the precise additional amount and the concrete resource needed; do not silently increase the budget.

The operator has authorized the use of the listed credentials for bounded procurement; this does not authorize unlimited spend.

### 0.2 Secret-handling law

1. Read credentials only from the approved secret vault/provider integration. Do not search arbitrary disks, browser profiles or backups for secret values.
2. Never print, echo, hash, prefix/suffix, commit, paste into chat, include in issue bodies, or pass credential values as command-line arguments.
3. Never put a credential-bearing URL in shell history, logs, process arguments, Git remote config, generated reports or a repo file.
4. Do not recover a PAT by parsing the password field of `git remote get-url origin`. The previous station report records that technique; it must not be repeated. Use a tokenless remote plus the secure credential injector/helper.
5. Record only credential name, provider, availability, scope class, validation result and timestamp. Do not record token length, value, hash or partial value.
6. If a plaintext token has entered tracked files, CI logs, shared terminal output, an agent prompt or an untrusted process, treat it as exposed: provision a least-privilege replacement, validate it, migrate consumers, then revoke the exposed token in a coordinated change.
7. Give each worker only the provider credential(s) required for its task. Prefer host-allowlisted secret injection or provider-native secret stores over broad environment exports.

---

## 1. Current source-verified position

The current branch tip is `04abd77cad1205223c337e49444ffd2134472d74`. Its SIG-39 commit changes only `WORKLOG.md` and `docs/plans/wave-claims.md`; GitHub Actions run `43143793577` completed successfully with `test`, `lint` and `typecheck` all green.

The G2 evidence already exists on `main`. It records:

- Production project and deployment preflight against the `tepa` team project and deployment SHA `1dda689`.
- Two real public post IDs tested on desktop Chromium and mobile Chromium emulation.
- TikTok player requests redirected `302 → /hk/about`; no player-ready, playing-state, advancing-time or visible-frame proof was observed.
- The app's readiness-timeout message and one-shot telemetry worked; the single-active-player mount law held under the wall.
- A real iOS Safari / Android Chrome device run has not been completed.
- The accepted result is **BLOCKED — NETWORK**, not a successful playback result.

G2 evidence and its operator replay instruction are at:
`evidence/wfx2-tiktok-main-interface-reliability/g2/EVIDENCE.md`.

The proof instruments are already on `main`:
- `scripts/ops/tiktok-playback-proof.py`
- `scripts/ops/watch-playback-proof.py`
- `scripts/ops/player-host-proof.py`
- `scripts/ops/expand-diag.py`
- `scripts/ops/mobile-375-walk.py`
- `scripts/ops/window-open.py`

**Important portability defect to resolve before dispatching the G2 replay:** the current TikTok proof script begins with a shell shim that executes `/home/z/.venv/bin/python`. That absolute path is workstation-specific. A runner on another machine must not be expected to have it. Worker B must make the proof entrypoint portable and self-tested before Worker C asks an operator/device to run it. Keep the proof logic/verdict rules unchanged.

The earlier CI ghost run `43098082637` was reported queued, while the SIG-39 run completed successfully. Recheck the ghost once at window open and once at close; do not let it consume repeated windows or create empty commits merely to retrigger CI.

---

## 2. Mission and order of work

This handoff has four outcomes, in priority order:

1. **Stop recurring station damage at its source.** The repeated five-surface erasure is not resolved by another successful restore cycle.
2. **Provision a durable, appropriately isolated development/agent workspace** using the available provider credentials, so workspace persistence and tool availability are no longer recurring manual blockers.
3. **Make the G2 proof instrument portable and execute the real supported-network replay**, including a physical mobile-device run.
4. **Keep all product, deployment, policy and money gates honest.** Infrastructure provisioning must not be used as a pretext to reopen restricted TikTok data collection.

This is a reliability/infrastructure/proof wave. It is not permission to add TikTok features, alter the product's legal position, or deploy a new production build.

---

## 3. Credential inventory and provider selection

### 3.1 Inventory first — values remain secret

At the start of the window, inspect:

- the existing `/home/z/.secrets` vault and its permissions, if the TL is operating in that environment;
- provider-native secret stores and connected applications;
- environment-injected credentials available to the agent runtime;
- the GitHub repository integration and provider account identities.

Reconcile the available credentials against the ten providers listed in §0. Record a **names-only** availability matrix. A key in a list or an old WORKLOG entry is not proof that it is present or authorized now.

Validate each available credential with a minimal, read-only API request first. Do not run provisioning calls merely to discover whether a key is valid. Check provider account, workspace/team/project, permission scopes, billing status, existing credits, usage, current resources and quota ceilings before selecting a product.

If a key is missing, try another already-authorized provider capable of the same job. Do not ask the operator for the same key again when it is already connected elsewhere.

### 3.2 Preferred fit-for-purpose allocation

Do not provision every provider. Pick one primary service for each actual need, compare live account-level pricing, and record why it was selected.

| Need | Preferred candidate | Use it for | Constraints |
|---|---|---|---|
| Durable agent/developer workspace | **Daytona** first choice; E2B as fallback | Persistent project workspace, reproducible tools, isolated worker environments, durable working volumes and secrets | Verify current plan, persistence, secret injection and resource expiry. One primary workspace only; do not create duplicate always-on environments. |
| Disposable agent/browser compute | **E2B** or **Modal** | Short-lived Playwright runs, parallel audits, scripted probes, bounded workers | Use only when it improves a measured task. Set timeouts and terminate/pause after use. |
| Browser sessions / evidence capture | **Cloudflare Browser Run** | Standard browser automation, screenshots and interactive debugging | A Cloudflare-hosted browser is still cloud egress unless proven otherwise. It is not automatically a supported TikTok viewer network. |
| Evidence/archive storage | **Cloudflare R2** | Sanitized test logs, screenshots, short recordings, environment manifests and backups | Private bucket, narrow token scope, retention/lifecycle policy, no secrets or raw browser profiles. |
| Disposable Postgres | **Neon** | Temporary branch DB for Postgres parity, migrations and integration tests when SQLite alone is insufficient | Branch from the approved schema, use a dedicated test role, expiry/cleanup. Do not change production `DATABASE_URL` or migrate production in this task. |
| Redis/queue | **Upstash Redis** | Only where a tested queue/cache dependency actually requires it | The previously recorded URL was DNS-dead from the sandbox. Revalidate DNS, region and REST/TCP protocol. Provision a replacement only if needed; do not wire an unverified endpoint. |
| Bounded model calls | **OpenRouter** | Only agent tasks that require model inference not already covered by the runtime | Choose a low-cost fit-for-task model, bound tokens/requests, use provider spend limits if available. Never send secrets or unnecessary personal data. |
| Preview/deployment control | **Vercel** | Verify canonical project/team/deployment and, if authorized, disposable preview/staging work | The previous Vercel status reported `Account is blocked`. Verify the correct `tepa` team project and account status. Do not bypass account restrictions or deploy to production in this wave. |
| Actor/data automation | **Apify** | Only unrelated, independently approved tasks | **No Apify calls, actor runs, credit purchases or credential swaps for TikTok LIVE/status/stream collection while D2 is closed.** |

Official capability references to re-check against current account terms before use:

- Daytona secrets: https://www.daytona.io/docs/secrets
- Daytona volumes: https://www.daytona.io/docs/en/volumes/
- E2B: https://e2b.dev/docs
- Modal pricing and budgets: https://modal.com/pricing
- Cloudflare Browser Run: https://developers.cloudflare.com/browser-run/get-started/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Neon branching: https://neon.com/docs/guides/branching
- Upstash Redis: https://upstash.com/docs/redis/overall/getstarted
- Vercel deployment docs: https://vercel.com/docs/deployments
- OpenRouter API: https://openrouter.ai/docs
- Apify legal terms (TikTok restriction still applies independently): https://docs.apify.com/legal/general-terms-and-conditions

Provider capabilities and prices can change. Current account console/usage/billing and current official docs outrank remembered prices or older reports.

### 3.3 Durable workspace acceptance

Provision one primary persistent workspace using the best currently authorized option (prefer Daytona if its available plan and secret controls meet requirements; otherwise evaluate E2B or another listed provider).

It must have:

- a persistent project directory/volume that survives stop/restart and new agent sessions;
- a reproducible pinned toolchain (repo runtime, package manager, Playwright/browser dependencies, Python runtime);
- secure provider secret injection that does not store plaintext credentials in the project tree or workspace snapshot;
- separate branches/worktrees and separate temp databases for concurrent workers;
- an immutable or recoverable baseline and regular Git push/checkpoint discipline;
- a documented owner, region, size, TTL/scale-to-zero behavior, cost cap and teardown command;
- an operator-visible health check that reports workspace identity, repo SHA, worktree status, database path/seed census and toolchain versions — **never secret values**.

Do not create both a Daytona and E2B long-running workstation "just in case". Provision one, verify it, and use short-lived Modal/E2B jobs only for genuinely parallel or disposable workloads.

---

## 4. Station damage — forensic root cause, not another restore loop

Window 43 reported the twenty-seventh full five-surface firing: ten tracked files removed, vault absent, home copy absent, database seam drifted to `custom.db`, and seed census de-seeded to zero. The restore succeeded, but the source of repeated mutation remains unresolved.

### 4.1 Preserve first

Before cleanup/reset/restore:

1. Capture exact `git status --porcelain=v2`, HEAD, origin/main, refs, reflog and changed-path list.
2. Create a local Git bundle or equivalent recoverable snapshot of unpushed commits/objects. Store only the non-secret bundle in the private evidence store.
3. Capture file metadata for the ten tracked files, the vault directory (metadata only), home-copy script, database paths and seed DB. Do not copy secret values into the bundle or evidence.
4. Do not reset, `git clean`, restore, reseed, overwrite the DB seam or rebuild the vault until the forensic snapshot is complete, unless active corruption threatens the only copy.

### 4.2 Instrument the erasure and drift actors

Identify the process that repeatedly:

- removes the same ten tracked files;
- removes or replaces `/home/z/.secrets`;
- removes the home copy of `window-open.py`;
- changes `DATABASE_URL` from `webflix2.db` to `custom.db`;
- de-seeds the database.

Use an appropriate local mechanism (for example auditd/inotify/fanotify or an equivalent process/file audit available on the managed workspace). Record timestamp, path, operation, PID, executable, parent process, cgroup/container/workspace identity and triggering job/service. Redact command arguments and environment values when they could contain secrets.

Inspect likely mutation sources: setup/bootstrap scripts, agent workspace restore/snapshot hooks, ephemeral home-directory mounts, cleanup jobs, cron/systemd timers, parallel worker processes, auto-scaffold/auto-commit services and volume remount behavior.

Do not infer a cause from recurrence counts. A measured process/file event or an independently reproducible experiment must support the root-cause claim.

### 4.3 Scaffold-commit handling

The current SIG-39 record describes unpushed scaffold commit `1fc74dc` as benign, but that SHA is not resolvable from GitHub. It must not be cited as source-verified until the local commit/object is preserved and its parent, author, tree, exact diff and tracked-path effects are independently inspected.

For every future auto-scaffold commit:
- preserve the commit object before reset;
- verify parent against the exact origin/main SHA;
- inspect the entire diff, not only the ten-file inventory;
- classify tracked, untracked, ignored and generated files separately;
- never push an unexplained scaffold commit automatically.

### 4.4 Root-cause exit

This milestone is not complete when the files are merely restored. It is complete when:

- the mutation source is identified with evidence, or a controlled experiment narrows it to a specific platform layer;
- the offending behavior is disabled/fixed or isolated in a durable managed workspace;
- three consecutive window-open checks show no unexplained loss of the five surfaces;
- workspace restart/resume does not change the repo tree, secret-vault metadata, database seam or seed census;
- the root cause and prevention are recorded in a repo-owned incident note.

If a host-level audit capability is unavailable, provision an appropriate managed environment and reproduce there. Do not spend more windows repeating the same uninstrumented restore sequence.

---

## 5. G2: portable instrument + real supported-network playback

### 5.1 Portability fix (Worker B)

Inspect `scripts/ops/tiktok-playback-proof.py` and remove the hard-coded `/home/z/.venv/bin/python` dependency without changing its verdict logic.

Requirements:

- run under a documented, reproducible Python environment on a clean Linux/macOS workstation;
- use `python3`/the activated virtual environment or an explicit supported interpreter override;
- fail early with an actionable dependency message if Playwright or browsers are missing;
- preserve all existing verdicts, protocol trust checks, event sampling, timeout handling, mount census, overflow law and sanitization;
- add offline self-tests for interpreter selection and help/selftest paths;
- run the existing proof self-tests and compare the verdict/classifier behavior before/after;
- make the same entrypoint runnable from the durable workspace and from an operator-owned machine.

Do not weaken the playback acceptance criteria to accommodate a runner.

### 5.2 Correct network for TikTok G2 (Worker C + TL)

The G2 wall is an **egress/network-class limitation**, not a lack of CPU, RAM, database capacity or a missing API token. More generic cloud compute is not automatically an answer.

The target is a genuine viewer connection on which TikTok serves its official public Embed Player: an operator-controlled residential broadband connection or a real mobile carrier connection, with a physical browser/device. Use an independently operated real-device test service only if it can prove that the actual device uses a supported carrier/residential network.

**Not permitted:**
- residential proxy providers, rotating proxy pools or geo-spoofing services;
- VPN/egress relays selected to defeat TikTok's network restriction;
- private TikTok endpoints, cookie reuse, scraper actors, extracted media bytes, repackaged streams or watermark bypasses.

Cloudflare Browser Run, Modal, E2B and Daytona cloud sandboxes may be useful for normal browser QA and toolchain reliability, but do not assume they provide residential/mobile egress. A successful HTTP 200 or the absence of an error on a cloud runner does not establish a supported viewer network.

If a listed provider offers an actual physical mobile device/carrier test capability under the connected account, verify its device model, carrier/network class, data charges and terms before using it. Otherwise, do not buy an unrelated datacenter VM and call the network blocker resolved. Record the specific external physical-network dependency and continue all other work.

### 5.3 Required replay

Run from the proven supported-network endpoint against the verified production alias:

```bash
WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app \
  bash scripts/ops/tiktok-playback-proof.py

WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app \
  bash scripts/ops/watch-playback-proof.py
```

Then run the mobile-emulation supplements:

```bash
PROOF_VIEWPORT=375x812 WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app \
  bash scripts/ops/tiktok-playback-proof.py

PROOF_VIEWPORT=375x812 WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app \
  bash scripts/ops/watch-playback-proof.py
```

The TikTok G2 requirement still includes a **real iOS Safari or Android Chrome physical-device run**. Mobile emulation is supplemental only.

For the two real TikTok posts already recorded in evidence, capture:
- deployment/project/domain and exact deployed SHA;
- coarse country/region and network class only (no IP);
- browser, OS, device and viewport;
- official player iframe origin;
- `onPlayerReady`, `onStateChange=1`, and current-time progression for at least five seconds;
- visible frame progression;
- transition from post A to post B, with previous player paused/unmounted and one active iframe at rest;
- hidden-tab pause/resume, mute behavior and audible-player exclusivity;
- sanitized logs, timestamps and redacted screenshots/short recordings.

Also run the YouTube `/watch` proof in the same session. The latest evidence reports both TikTok G2 and the YouTube playback lane blocked on datacenter egress; verify both against the actual supported network instead of assuming only TikTok is affected.

Results must remain honest:
- `PASS` only if all required player events and frame/time evidence exist on the required platforms/devices;
- `PARTIAL` when only a subset is proven;
- `BLOCKED — NETWORK` if the genuine supported endpoint cannot be obtained or TikTok still wall-redirects;
- `FAIL — PLAYER` if TikTok serves the official player but it cannot play;
- `FAIL — INSTRUMENTATION` only when the portable instrument cannot correctly observe its documented protocol.

A blocked result is acceptable evidence; it is not permission to claim the interface is playback-proven.

---

## 6. Explicit policy, deployment and money boundaries

The infrastructure delegation in §0 does **not** override any of these gates:

1. **D2 / TikTok LIVE:** remain CLOSED / operator-gated. Do not call `unseenuser/tiktok-live-status-scraper`, `automation-lab/tiktok-live-room-stream-urls`, Euler or another actor/provider for TikTok status/stream collection. No actor run, credit purchase, new key swap, HLS playback or polling test. The terms/privacy review in `evidence/wfx2-tiktok-main-interface-reliability/m2/TERMS-REVIEW.md` remains decision evidence, not legal approval.
2. **Display API / OAuth:** no new scopes or production activation. `video.list` remains disabled until TikTok app/scope approval, user consent and written product-use clearance for the primary-interface ambition are recorded.
3. **Production deployment:** no production deploy, domain reassignment, production environment edit or database migration in this wave. Use preview/staging or disposable resources for infrastructure validation. The currently recorded production deployment remains `1dda689` until a separate release authorization changes it.
4. **Vercel restriction:** do not circumvent an `Account is blocked` response by moving the site to a personal project, new team or unrelated account. Diagnose the exact authorized team project and record the provider response; keep the existing deployment intact.
5. **YouTube and product behavior:** do not change product behavior just to make the test pass. Any newly discovered product defect becomes a separate red-first issue with explicit file ownership and review.
6. **Money/creator features:** gifts, tips, payments, creator payouts, wallet flows and other money movement remain out of scope.
7. **Apify:** the presence of an API key or budget authority is not permission for TikTok data collection. Zero TikTok-lane spend remains mandatory.

---

## 7. Team structure and file ownership

Use TL + three workers, with strictly disjoint ownership. TL must first update `docs/plans/wave-claims.md` with exact claims, base SHA and assigned files before dispatch.

| Owner | Assignment | Exclusive primary ownership |
|---|---|---|
| TL | M0 audit, credential/account inventory, procurement decision, policy/release gates, integration, evidence sign-off | `WORKLOG.md`, `docs/plans/wave-claims.md`, final incident/evidence summaries and shared integration |
| Worker A | Station-damage forensics, durable workspace provisioning, workspace restore/restart acceptance | `scripts/ops/workspace-*`, `docs/ops/workspace-reliability/*`, related tests |
| Worker B | Provider inventory/provisioning support and G2 runner portability | `scripts/ops/tiktok-playback-proof.py`, its self-tests, `docs/ops/infra-procurement/*` |
| Worker C | Supported-network/real-device execution, TikTok and YouTube playback evidence | `evidence/wfx2-tiktok-main-interface-reliability/g2/**` only |

Rules:
- No two workers edit the same file or database schema.
- Workers do not receive credentials they do not need.
- No worker deploys to production or performs Apify/TikTok provider calls.
- If a product-source fix is necessary, stop and have TL open a separate task; do not expand this work order silently.
- TL alone resolves cross-worker conflicts and signs off final claims.

---

## 8. CI and branch discipline

1. Pin `origin/main` before each window. Current starting SHA is `04abd77`; if main moved, record the exact new SHA and re-audit the delta before dispatch.
2. Keep each worker in a separate branch/worktree and a separate test DB.
3. Do not use empty docs commits as a routine response to queued/zombie GitHub Actions runs. Poll the existing phantom `43098082637` once at window open and once at close; record its status and otherwise ignore it if newer runs pass.
4. Require the protected checks `test`, `lint`, and `typecheck` on every implementation PR. Distinguish successful completed jobs from queued, in-progress, cancelled, skipped or orphaned jobs.
5. Do not call a local-only commit shipped. Every final claim must point to a commit on `origin/main`.
6. PR #8 is a stale draft based on the earlier `e0c8c63` baseline. This final handoff supersedes it as the consolidated operator instruction. Do not merge duplicate or stale work-order text blindly; after this handoff is merged, close PR #8 as superseded or extract only content that is still missing and non-conflicting.
7. Issue #7 remains the G2 evidence tracker. Do not close it until the real supported-network/device run has a final evidence classification.

---

## 9. Required evidence and reports

Create the following repo-owned evidence:

- `evidence/wfx2-infra-reliability/credential-inventory.md` — names-only credential availability/scope/validation matrix; no values or hashes.
- `evidence/wfx2-infra-reliability/procurement-ledger.md` — resource, provider, purpose, owner, region, size, creation time, expiry/TTL, free-credit consumption, estimated/actual USD cost, budget remaining and teardown state.
- `evidence/wfx2-infra-reliability/station-root-cause.md` — exact file-event/process evidence, identified cause or bounded hypothesis, containment and restart proof.
- `evidence/wfx2-infra-reliability/workspace-acceptance.md` — toolchain versions, workspace persistence, restart/resume results, database seam/seed census and recovery check.
- `evidence/wfx2-tiktok-main-interface-reliability/g2/EVIDENCE.md` — update existing G2 verdict only after the supported-network run; preserve historical blocked measurements.
- `evidence/wfx2-tiktok-main-interface-reliability/g2/desktop/` and `mobile/` — sanitized logs and redacted image/video evidence.
- `WORKLOG.md` and `docs/plans/wave-claims.md` — update after evidence exists, not before.

The procurement ledger must include teardown/expiry proof for disposable resources. Never leave a test database, browser session, worker, container, scheduled job or paid model endpoint running after its task completes.

---

## 10. Acceptance

This handoff is complete only when all applicable items below are verified:

### Infrastructure
- [ ] All ten named provider credential sources have been checked; available credentials are validated read-only; missing credentials are identified precisely.
- [ ] A provider choice matrix records why the selected infrastructure is the smallest appropriate fit.
- [ ] One durable primary workspace is provisioned and passes stop/restart plus persistent-volume and secret-injection tests.
- [ ] At least one disposable worker/browser execution lane is available if needed, with cost/TTL controls.
- [ ] Neon/Upstash/Cloudflare resources are provisioned only when a concrete measured need exists.
- [ ] All costs are within the USD 25 aggregate envelope; resources are stopped or deleted and teardown is proven.
- [ ] No production deploy, production DB migration, TikTok actor call, OAuth scope activation or policy gate was performed.

### Station reliability
- [ ] The repeated five-surface erasure has a measured root cause or is isolated in a durable workspace with a documented forensic boundary.
- [ ] The unpushed scaffold commit claim is either preserved and source-verified or explicitly left unverified.
- [ ] Three consecutive workspace window-open checks show no unexplained file/vault/seam/seed loss.
- [ ] The Git remote contains no plaintext PAT; secrets are absent from repository, logs and workspace snapshots.

### Playback proof
- [ ] TikTok proof script runs portably on a clean machine without `/home/z` hard-coded paths.
- [ ] The supported-network endpoint is a genuine residential/mobile-carrier viewer connection, not a proxy or datacenter VM.
- [ ] TikTok VOD post A and B are measured with ready + playing + time/frame progression.
- [ ] Desktop and real physical mobile-device lifecycle checks pass or are honestly classified blocked/failed.
- [ ] YouTube `/watch` is measured in the same supported session and its result is recorded separately.
- [ ] Evidence is committed and the G2 issue is updated with the exact classification.

A failure to obtain a genuine supported-network test endpoint is a real external limitation. In that case, document the exact physical-device/network resource that would be needed and the cheapest lawful acquisition option. Do not purchase a generic cloud VM, assume it solves TikTok's egress wall, or weaken the acceptance criteria.

---

## 11. First actions for the TL

1. Verify `main` and this work-order PR base; freeze wave claims and worker ownership.
2. Run the secure names-only inventory of GitHub, Cloudflare, Modal, Neon, OpenRouter, E2B, Vercel, Apify, Upstash Redis and Daytona credentials. Validate only what is available.
3. Poll phantom CI run `43098082637` once; preserve the result and do not start a retry loop.
4. Preserve the current station evidence and investigate the repeated deletion/drift source before another reset/restore.
5. Select and provision one durable workspace using the authorized provider credentials and the bounded spend policy.
6. Make the TikTok proof runner portable without changing its protocol/verdict law.
7. Arrange the genuine supported-network physical browser run; run the TikTok and YouTube proof instruments in the same session.
8. Update the repository evidence, work log and claims only after results exist.

**Operator instruction:** Infrastructure procurement is delegated. Use the available credentials, select appropriate resources, and solve infrastructure problems within the safeguards above. Do not turn a solvable infrastructure issue into another request for the operator to manually provision a service.
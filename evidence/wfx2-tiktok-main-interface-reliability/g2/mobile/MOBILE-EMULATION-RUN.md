# WFX2-G2 mobile lane record — EMULATION ONLY (§3.3 law)

Command: `PROOF_VIEWPORT=375x812 bash scripts/ops/tiktok-playback-proof.py` (2026-11-09T08:2xZ, sandbox datacenter egress, headless Chromium via Playwright 1.57.0).

Result: **GEO-WALLED ×3, identical signature to the desktop lane** (`/player/v1/<id>` → 302 → `https://www.tiktok.com/hk/about`, final 200); honest readiness-timeout banners; 0px overflow ×3; the exactly-one mount law clean; exit 0. Raw sanitized log: `MOBILE-EMULATION-RUN.txt`.

**This run does NOT satisfy §3.3's real-device requirement** — browser emulation supplements and does not replace a real iOS Safari / Android Chrome device. The real-device run is part of the operator action in `../EVIDENCE.md` §8 (the same one-command instrument, then §3.3–3.7 by hand on the device).

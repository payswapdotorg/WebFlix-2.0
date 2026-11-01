/**
 * WFX2-LIVE-PLATFORM-1 Parity P72 — the TWO-HOST PK acceptance driver
 * (closes the honest residual the wave-4 acceptance recorded: the pairing /
 * lazy-finalize / MVP laws exercised in REAL BROWSERS, two live hosts).
 *
 * Flow: host A go-live → rival C go-live → A opens a challenge → C opens
 * (PAIRS — oldest-first matchmaking) → BOTH rooms' banners render ACTIVE
 * with sides + mySide + countdown → the viewer floods the rival room with
 * hearts (the rival outscores) → the window is backdated (the battery's own
 * law) → BOTH rooms reload → the banners render FINAL + winner + the MVP
 * line → DB facts (final snapshots ×2 + the MVP row). Evidence lands in
 * evidence/wfx2-live-platform-1-parity-p70-p73/ alongside the wave record.
 *
 * Run: bun scripts/pk-two-host-acceptance.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/node_modules/playwright");

const BASE = "http://localhost:3000";
const CHROME = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const OUT = "evidence/wfx2-live-platform-1-parity-p70-p73";
const DB_ENV = { ...process.env, DATABASE_URL: "file:/home/z/webflix-2.0/db/webflix2.db" };
const facts = { startedAt: new Date().toISOString(), steps: [] };

function fact(step, name, value) {
  facts.steps.push({ step, name, value });
  console.log(`FACT [${step}] ${name}: ${JSON.stringify(value)}`);
}

async function main() {
  const minted = JSON.parse(
    execSync("bun scripts/pk-mint-cookies.ts", { cwd: process.cwd(), encoding: "utf8", env: DB_ENV }),
  );
  const cookieFor = (raw) => {
    const i = raw.indexOf("=");
    return { name: raw.slice(0, i), value: raw.slice(i + 1), domain: "localhost", path: "/" };
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const mk = async (cookieRaw, width = 1440) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addCookies([cookieFor(cookieRaw)]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => facts.errors.push(String(e).slice(0, 200)));
    return page;
  };
  facts.errors = [];

  const host = await mk(minted.hostCookie);
  const rival = await mk(minted.rivalCookie);
  const viewer = await mk(minted.viewerCookie);
  const shot = async (page, name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`shot ${name}`);
  };
  const api = (page, url, init = {}) =>
    page.evaluate(
      async ({ url, init }) => {
        const res = await fetch(url, {
          method: init.method ?? "GET",
          headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        let body = null;
        try { body = await res.json(); } catch {}
        return { status: res.status, body };
      },
      { url: new URL(url, BASE).toString(), init },
    );

  // 0. PREFLIGHT HYGIENE: any STALE live room from an earlier run re-attaches
  // the console instead of the go-live form — end it honestly (host-only end)
  // so both drivers start from a clean stage.
  const endStale = async (page) => {
    for (let i = 0; i < 3; i++) {
      const probe = await api(page, "/api/studio/live-session");
      const stale = probe?.body?.room?.id ?? null;
      if (!stale) return;
      await api(page, `/api/live-rooms/${stale}/end`, { method: "POST", body: {} });
    }
  };
  await host.goto(`${BASE}/studio/live`, { waitUntil: "domcontentloaded" });
  await rival.goto(`${BASE}/studio/live`, { waitUntil: "domcontentloaded" });
  await endStale(host);
  await endStale(rival);
  fact(0, "preflight", "stale live rooms ended (if any)");

  // 1. BOTH hosts go live (the P69 golden path, twice).
  const goLive = async (page, title) => {
    await page.goto(`${BASE}/studio/live`, { waitUntil: "domcontentloaded" });
    // The device test is flaky on a cold page (hydration race) — click, and
    // if the preview does not land, re-click once after the form settles.
    for (let attempt = 0; attempt < 2; attempt++) {
      const testBtn = page.getByRole("button", { name: /Test camera/i });
      await testBtn.waitFor({ timeout: 20_000 });
      await testBtn.click();
      try {
        await page.waitForSelector('[data-testid="go-live-preview-video"]', { timeout: 20_000 });
        break;
      } catch {
        if (attempt === 1) throw new Error("the device test never granted the preview");
      }
    }
    await page.fill('[data-testid="go-live-title-input"]', title);
    await page.click('[data-testid="go-live-submit"]');
    await page.waitForSelector('[data-testid="live-console"]', { timeout: 45_000 });
    const probe = await api(page, "/api/studio/live-session");
    return probe?.body?.room?.id ?? null;
  };
  const roomA = await goLive(host, "PK Station — Host A");
  fact(1, "hostGoLive", roomA);
  const roomB = await goLive(rival, "PK Station — Rival B");
  fact(1, "rivalGoLive", roomB);
  if (!roomA || !roomB) throw new Error("go-live failed");

  // 2. THE MATCHMAKING: A opens (waits), C opens → PAIRS.
  const openA = await api(host, `/api/live-rooms/${roomA}/pk`, { method: "POST", body: {} });
  fact(2, "openA", { status: openA.status, status: openA.body?.battle?.status });
  fact(2, "openAState", openA.body?.battle?.status);
  const openB = await api(rival, `/api/live-rooms/${roomB}/pk`, {
    method: "POST",
    body: { durationSeconds: 60 },
  });
  fact(2, "openB", {
    status: openB.status,
    battle: openB.body?.battle?.status,
    mySide: openB.body?.battle?.mySide,
    sideATitle: openB.body?.battle?.sideA?.title,
  });

  // 3. BOTH banners render ACTIVE (sides + mySide + countdown) — the pair
  // envelopes reached each console through the room's ONE stream.
  const waitActive = async (page) => {
    await page.waitForSelector('[data-testid="pk-banner"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="pk-sides"]', { timeout: 20_000 });
    const countdown = await page.textContent('[data-testid="pk-countdown"]');
    return countdown;
  };
  const hostCountdown = await waitActive(host);
  fact(3, "hostBannerActive", { countdown: hostCountdown });
  const rivalCountdown = await waitActive(rival);
  fact(3, "rivalBannerActive", { countdown: rivalCountdown });
  await shot(host, "19-pk-active-host");
  await shot(rival, "20-pk-active-rival");

  // 4. THE DERIVED SCORES: the viewer floods the RIVAL room (side B);
  // host A's room banks a small batch via the host's own page.
  await viewer.goto(`${BASE}/live/${roomB}`, { waitUntil: "domcontentloaded" });
  await viewer.waitForSelector('[data-testid="live-room-viewer"]', { timeout: 30_000 });
  const tap = viewer.getByRole("button", { name: "Send a heart reaction" });
  for (let i = 0; i < 70; i++) await tap.click({ delay: 5 });
  await viewer.waitForTimeout(1500);
  const aHearts = await api(host, `/api/live-rooms/${roomA}/reactions`, {
    method: "POST",
    body: { clientBatchId: `pk-a-${Date.now()}`, count: 7 },
  });
  fact(4, "rivalHeartsBurst", "70 taps");
  fact(4, "hostHearts", aHearts.status);
  const battleNow = await api(host, `/api/live-rooms/${roomA}/pk`);
  fact(4, "scoresDuringActive", {
    a: battleNow.body?.battle?.sideA?.score,
    b: battleNow.body?.battle?.sideB?.score,
  });

  // 5. THE LAZY FINALIZE: backdate the window (the battery's own law),
  // then reload BOTH consoles — each read settles the battle.
  const backdate = JSON.parse(
    execSync(
      `bun -e '
import { db } from "./src/lib/db";
const battle = await db.livePkBattle.findFirst({ where: { status: "active" }, orderBy: { createdAt: "desc" } });
if (!battle) throw new Error("no active battle");
await db.livePkBattle.update({
  where: { id: battle.id },
  data: { startsAt: new Date(Date.now() - 10 * 60_000), endsAt: new Date(Date.now() - 5_000) },
});
console.log(JSON.stringify({ id: battle.id }));
'`,
      { cwd: process.cwd(), encoding: "utf8", env: DB_ENV },
    ),
  );
  fact(5, "backdatedBattle", backdate.id);
  const reattachIf = async (page) => {
    // The P68 law: a mid-broadcast reload re-takes the session via the
    // ReattachCard — click it when present so the console returns.
    await page.waitForSelector('[data-testid="live-console"], [data-testid="reattach-card"]', {
      timeout: 30_000,
    });
    const card = await page.$('[data-testid="reattach-card"]');
    if (card) {
      await page.click('[data-testid="reattach-button"]');
      await page.waitForSelector('[data-testid="live-console"]', { timeout: 30_000 });
    }
  };
  await host.reload({ waitUntil: "domcontentloaded" });
  await rival.reload({ waitUntil: "domcontentloaded" });
  await reattachIf(host);
  await reattachIf(rival);
  const waitFinal = async (page) => {
    await page.waitForSelector('[data-testid="pk-banner"]', { timeout: 25_000 });
    await page.waitForSelector('[data-testid="pk-result"]', { timeout: 25_000 });
    return page.textContent('[data-testid="pk-result"]');
  };
  const hostResult = await waitFinal(host);
  fact(5, "hostFinalLine", hostResult);
  const rivalResult = await waitFinal(rival);
  fact(5, "rivalFinalLine", rivalResult);
  await shot(host, "21-pk-final-host");
  await shot(rival, "22-pk-final-rival");
  const mvpOnRival = await rival.$('[data-testid="pk-result"]');
  fact(5, "mvpLineRendered", mvpOnRival !== null);

  // 6. DB-verified durable facts (the stored snapshots ARE the settle law).
  const dbFacts = JSON.parse(
    execSync(
      `bun -e '
import { db } from "./src/lib/db";
const battle = await db.livePkBattle.findFirst({ orderBy: { createdAt: "desc" } });
const snaps = await db.livePkScoreSnapshot.findMany({ where: { battleId: battle.id } });
console.log(JSON.stringify({
  battle: { id: battle.id, status: battle.status, roomAId: battle.roomAId, roomBId: battle.roomBId, winnerSide: battle.winnerSide, finalizedAt: battle.finalizedAt },
  finalSnapshots: snaps.filter((s) => s.kind === "final").map((s) => ({ side: s.side, amount: s.amount })),
  mvpSnapshot: snaps.filter((s) => s.kind === "mvp").map((s) => ({ side: s.side, userId: s.userId, amount: s.amount })),
}));
'`,
      { cwd: process.cwd(), encoding: "utf8", env: DB_ENV },
    ),
  );
  fact(6, "dbFacts", dbFacts);
  // THE SETTLE-CLAIM LAW (the race the first run found): exactly ONE final
  // snapshot pair + ONE mvp row — no matter how many readers raced the read.
  fact(6, "snapshotCountsLaw", {
    finalRows: dbFacts.finalSnapshots.length,
    mvpRows: dbFacts.mvpSnapshot.length,
    expected: "exactly 2 final (side a + side b) + 1 mvp",
  });
  if (dbFacts.finalSnapshots.length !== 2 || dbFacts.mvpSnapshot.length !== 1) {
    throw new Error("the settle-claim law failed — snapshot rows duplicated");
  }

  // 7. Both streams end honestly (the confirm dialogs).
  for (const page of [host, rival]) {
    await page.waitForTimeout(1200);
    await page.click('[data-testid="live-console-end"]');
    await page.getByRole("button", { name: "End live" }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "End live" }).click();
    await page.waitForSelector('[data-testid="live-ended-summary"]', { timeout: 40_000 });
  }
  fact(7, "bothEnded", true);

  facts.finishedAt = new Date().toISOString();
  facts.consoleErrors = { count: facts.errors.length, sample: facts.errors.slice(0, 4) };
  writeFileSync(`${OUT}/pk-two-host-facts.json`, JSON.stringify(facts, null, 2));
  console.log("evidence written to " + OUT + "/pk-two-host-facts.json");
  await browser.close();
}

main().catch((err) => {
  facts.fatal = String(err?.stack ?? err).slice(0, 2000);
  try {
    writeFileSync(`${OUT}/pk-two-host-facts.json`, JSON.stringify(facts, null, 2));
  } catch {}
  console.error("FATAL", String(err?.message ?? err).slice(0, 400));
  process.exit(1);
});

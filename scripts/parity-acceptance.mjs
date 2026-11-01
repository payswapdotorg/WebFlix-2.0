/**
 * WFX2-LIVE-PLATFORM-1 Parity P70-P73 — the two-browser acceptance driver
 * (the P68/P69 engine pattern: REAL Chromium via the repo-external
 * playwright install, fake camera/mic, two real cookie-injected identities).
 *
 * Produces evidence/wfx2-live-platform-1-parity-p70-p73/ — numbered
 * screenshots + acceptance-facts.json. Every fact is either a DOM state the
 * page rendered or a DB row the battery-verified routes wrote; nothing is
 * claimed that the browser did not show or the DB does not hold.
 *
 * Run: bun scripts/parity-acceptance.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/node_modules/playwright");

const BASE = "http://localhost:3000";
const CHROME = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const OUT = "evidence/wfx2-live-platform-1-parity-p70-p73";
const facts = { startedAt: new Date().toISOString(), steps: [] };

function fact(step, name, value) {
  const entry = { step, name, value };
  facts.steps.push(entry);
  console.log(`FACT [${step}] ${name}: ${JSON.stringify(value)}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // 1. Mint the two real session cookies (the repo's own mint law).
  const minted = JSON.parse(
    execSync("bun scripts/parity-mint-cookies.ts", {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "file:/home/z/webflix-2.0/db/webflix2.db" },
    }),
  );
  const cookieFor = (raw) => {
    const idx = raw.indexOf("=");
    return { name: raw.slice(0, idx), value: raw.slice(idx + 1), domain: "localhost", path: "/" };
  };
  const hostId = minted.hostId;
  const viewerId = minted.viewerId;

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await hostCtx.addCookies([cookieFor(minted.hostCookie)]);
  const hostPage = await hostCtx.newPage();
  const hostErrors = [];
  hostPage.on("pageerror", (e) => hostErrors.push(String(e)));

  const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await viewerCtx.addCookies([cookieFor(minted.viewerCookie)]);
  const viewerPage = await viewerCtx.newPage();
  const viewerErrors = [];
  viewerPage.on("pageerror", (e) => viewerErrors.push(String(e)));

  const shot = async (page, name) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    console.log(`shot ${name}`);
  };

  /** In-page same-origin fetch (the session rides the context's cookie). */
  const api = (page, url, init = {}) =>
    page.evaluate(
      async ({ url, init }) => {
        const res = await fetch(url, {
          method: init.method ?? "GET",
          headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        let body = null;
        try {
          body = await res.json();
        } catch {}
        return { status: res.status, body };
      },
      { url: new URL(url, BASE).toString(), init },
    );

  // ── HOST: the preflight (navigate FIRST — the in-page API probes share
  // the page's origin) ──
  await hostPage.goto(`${BASE}/studio/live`, { waitUntil: "domcontentloaded" });
  // ── BEFORE go-live: the host owns a club and the viewer is a member, so
  // the go-live fan-out (P73-3) has a community to notify. ──
  const clubCreate = await api(hostPage, "/api/live-clubs", {
    method: "POST",
    body: { name: `Parity Station Crew ${Date.now() % 10000}` },
  });
  fact(0, "clubCreate", { status: clubCreate.status, body: clubCreate.body });
  await viewerPage.goto(`${BASE}/live`, { waitUntil: "domcontentloaded" });
  const clubJoin = await api(viewerPage, `/api/live-clubs/${hostId}/join`, {
    method: "POST",
    body: {},
  });
  fact(0, "clubJoin", { status: clubJoin.status, body: clubJoin.body });
  await hostPage.getByRole("button", { name: /Test camera/i }).click();
  await hostPage.waitForSelector('[data-testid="go-live-preview-video"]', { timeout: 30_000 });
  fact(1, "deviceTest", "go-live-preview-video visible");
  await shot(hostPage, "01-host-preflight");
  await hostPage.fill('[data-testid="go-live-title-input"]', "Parity Station LIVE — P70-P73");
  await hostPage.click('[data-testid="go-live-submit"]');
  await hostPage.waitForSelector('[data-testid="live-console"]', { timeout: 45_000 });
  fact(1, "goLive", "live-console visible");
  await hostPage.waitForTimeout(1500);
  await shot(hostPage, "02-host-live-console");

  const sessionProbe = await api(hostPage, "/api/studio/live-session");
  const roomId = sessionProbe?.body?.room?.id ?? null;
  fact(1, "roomId", roomId);
  if (!roomId) throw new Error("no active room after go-live");

  // ── VIEWER: discovery (the honest empty trending state BEFORE engagement)
  await viewerPage.goto(`${BASE}/live`, { waitUntil: "domcontentloaded" });
  await viewerPage.waitForSelector('[data-testid="live-badge"]', { timeout: 30_000 });
  fact(2, "discovery", "live-badge visible");
  fact(2, "trendingBeforeEngagement", {
    shelfRendered: (await viewerPage.$('[data-testid="live-trending"]')) !== null,
  });
  await shot(viewerPage, "03-discovery-live-room");

  // ── P70-3: the goal card (empty state first, then the open goal) ──
  await viewerPage.goto(`${BASE}/live/${roomId}`, { waitUntil: "domcontentloaded" });
  await viewerPage.waitForSelector('[data-testid="live-room-viewer"]', { timeout: 30_000 });
  fact(3, "viewerRoom", "live-room-viewer visible");
  await viewerPage.waitForSelector('[data-testid="goal-empty"]', { timeout: 15_000 });
  fact(3, "goalEmptyState", "goal-empty visible");
  await shot(viewerPage, "04-viewer-room-empty-states");

  const goal = await api(hostPage, `/api/live-rooms/${roomId}/goals`, {
    method: "POST",
    body: { kind: "hearts", target: 6, title: "Hearts sprint" },
  });
  fact(4, "goalCreate", goal.status);
  await viewerPage.waitForSelector('[data-testid="goal-card"]', { timeout: 20_000 });
  fact(4, "goalCardOpen", "goal-card visible via the goal envelope");

  // Viewer taps 6+ hearts (the reaction rail's tap button).
  const tap = viewerPage.getByRole("button", { name: "Send a heart reaction" });
  for (let i = 0; i < 8; i++) {
    await tap.click();
    await viewerPage.waitForTimeout(450);
  }
  fact(5, "heartsTapped", 8);
  await viewerPage.waitForSelector('[data-testid="goal-reached-badge"]', { timeout: 20_000 });
  await viewerPage.waitForSelector('[data-testid="goal-celebration"]', { timeout: 10_000 });
  fact(5, "goalReached", "goal-reached-badge + celebration visible");
  await shot(viewerPage, "05-goal-reached");

  // ── P70-1: combo gifts (two rapid sends → the ×2 chip) ──
  const g1 = await api(viewerPage, `/api/live-rooms/${roomId}/gifts`, {
    method: "POST",
    body: { giftItemId: "wave-hello", quantity: 1, clientRequestId: `parity-c1-${Date.now()}` },
  });
  const g2 = await api(viewerPage, `/api/live-rooms/${roomId}/gifts`, {
    method: "POST",
    body: { giftItemId: "wave-hello", quantity: 1, clientRequestId: `parity-c2-${Date.now()}` },
  });
  fact(6, "comboSends", [g1.status, g2.status]);
  fact(6, "comboCounts", [g1.body?.gift?.comboCount, g2.body?.gift?.comboCount]);
  await viewerPage.waitForSelector('[data-testid="gift-combo-chip"]', { timeout: 20_000 });
  fact(6, "comboChipRendered", "gift-combo-chip visible");
  await shot(viewerPage, "06-gift-combo-chip");

  // ── P70-2: the top-supporters wall (a room reload re-derives) ──
  await viewerPage.reload({ waitUntil: "domcontentloaded" });
  await viewerPage.waitForSelector('[data-testid="top-supporters-list"]', { timeout: 20_000 });
  fact(7, "topSupporters", "top-supporters-list visible");
  await shot(viewerPage, "07-top-supporters");

  // ── P71-3: the room-loyalty level chip (XP = 2×chat + 1×hearts + 1×gifts;
  // the 50 threshold) — burst 55 taps through the 400ms batcher (a handful
  // of batches, far under the 12/10s rail limit) then chat twice.
  const tapFast = viewerPage.getByRole("button", { name: "Send a heart reaction" });
  for (let i = 0; i < 90; i++) {
    await tapFast.click({ delay: 5 });
  }
  await viewerPage.waitForTimeout(1500);
  await viewerPage.fill("textarea", "hello from the parity viewer");
  await viewerPage.keyboard.press("Enter");
  await viewerPage.waitForTimeout(1200);
  await viewerPage.fill("textarea", "level check — should carry LV1");
  await viewerPage.keyboard.press("Enter");
  await viewerPage.waitForSelector('[data-testid="chat-room-level"]', { timeout: 20_000 });
  fact(8, "roomLevelChip", "chat-room-level visible");
  await shot(viewerPage, "08-room-level-chip");

  // ── P71-1: the pin (the viewer's own message, pinned by the host) ──
  const chatList = await api(hostPage, `/api/live-rooms/${roomId}/chat?limit=5`);
  const mine = [...(chatList.body?.messages ?? [])]
    .filter((m) => m.senderId === viewerId && !m.deleted)
    .at(-1);
  fact(9, "chatMessageFound", Boolean(mine));
  const pin = await api(hostPage, `/api/live-rooms/${roomId}/pin`, {
    method: "POST",
    body: { messageId: mine.id },
  });
  fact(9, "pin", pin.status);
  await viewerPage.waitForSelector('[data-testid="chat-pinned-banner"]', { timeout: 20_000 });
  fact(9, "pinnedBanner", "chat-pinned-banner visible");
  await shot(viewerPage, "09-pinned-banner");

  // ── P71-2: the announcement ──
  const ann = await api(hostPage, `/api/live-rooms/${roomId}/announcement`, {
    method: "POST",
    body: { body: "Parity wave announcement — welcome to the station." },
  });
  fact(10, "announcement", ann.status);
  await viewerPage.waitForSelector('[data-testid="room-announcement"]', { timeout: 20_000 });
  fact(10, "announcementBanner", "room-announcement visible");
  await shot(viewerPage, "10-announcement-banner");

  // ── P72-1: the screen-share state machine. The headless browser either
  // DENIES (the honest refusal renders its reason) or — with the fake-media
  // flags — GRANTS a synthetic display (the honest sharing state renders).
  // Either way the component's state machine is the verified surface.
  await hostPage.click('[data-testid="screen-share-button"]');
  const denied = hostPage.waitForSelector('[data-testid="screen-share-denied"]', {
    timeout: 12_000,
  }).then(() => "denied");
  const sharing = hostPage.waitForSelector('[data-testid="screen-share-active"]', {
    timeout: 12_000,
  }).then(() => "sharing");
  const failed = hostPage.waitForSelector('[data-testid="screen-share-failed"]', {
    timeout: 12_000,
  }).then(() => "failed");
  const shareOutcome = await Promise.race([denied, sharing, failed]).catch(() => "stuck-requesting");
  fact(11, "screenShareOutcome", shareOutcome);
  if (shareOutcome === "sharing") {
    // The full law: stop restores the camera.
    await shot(hostPage, "11-screen-share-sharing");
    await hostPage.click('[data-testid="screen-share-stop"]');
    await hostPage.waitForSelector('[data-testid="screen-share-controls"]', { timeout: 10_000 });
    fact(11, "screenShareRestored", "stop → the share control is back");
  } else {
    await shot(hostPage, "11-screen-share-denied");
  }

  // ── P73-1: the keyword filter end-to-end ──
  await hostPage.fill('[data-testid="keyword-draft"]', "spamword");
  await hostPage.click('[data-testid="keyword-add"]');
  await hostPage.waitForSelector('[data-testid="keyword-list"] >> text=spamword', {
    timeout: 15_000,
  });
  fact(12, "keywordAdded", "spamword in keyword-list");
  await shot(hostPage, "12-keyword-manager");
  await viewerPage.fill("textarea", "buy spamword now");
  await viewerPage.keyboard.press("Enter");
  await viewerPage.waitForSelector('[data-testid="chat-flagged"]', { timeout: 15_000 });
  fact(12, "flaggedRendered", await viewerPage.textContent('[data-testid="chat-flagged"]'));
  await shot(viewerPage, "13-chat-flagged");
  await viewerPage.fill("textarea", "");
  const linkProbe = await api(viewerPage, `/api/live-rooms/${roomId}/chat`, {
    method: "POST",
    body: { body: "see https://links.test/now", clientMessageId: `parity-link-${Date.now()}` },
  });
  fact(12, "linkProbeOff", linkProbe.status); // 200 while blockLinks is off
  const blockOn = await api(hostPage, `/api/live-rooms/${roomId}/keywords`, {
    method: "PATCH",
    body: { blockLinks: true },
  });
  fact(12, "blockLinksOn", blockOn.status);
  const linkProbe2 = await api(viewerPage, `/api/live-rooms/${roomId}/chat`, {
    method: "POST",
    body: { body: "see https://links.test/again", clientMessageId: `parity-link2-${Date.now()}` },
  });
  fact(12, "linkProbeOn", { status: linkProbe2.status, body: linkProbe2.body }); // 422 flagged
  const blockOff = await api(hostPage, `/api/live-rooms/${roomId}/keywords`, {
    method: "PATCH",
    body: { blockLinks: false },
  });
  fact(12, "blockLinksOff", blockOff.status);

  // ── P72-2: the PK open state (the banner renders; pairing is
  // battery-pinned — one live host in this driver, recorded honestly).
  const pkOpen = await api(hostPage, `/api/live-rooms/${roomId}/pk`, {
    method: "POST",
    body: { durationSeconds: 120 },
  });
  fact(13, "pkOpen", { status: pkOpen.status, battleStatus: pkOpen.body?.battle?.status });
  await viewerPage.waitForSelector('[data-testid="pk-open"]', { timeout: 20_000 });
  fact(13, "pkBannerOpen", "pk-open visible on the viewer");
  await shot(viewerPage, "14-pk-open-banner");
  const pkCancel = await api(hostPage, `/api/live-rooms/${roomId}/pk`, { method: "DELETE" });
  fact(13, "pkCancel", { status: pkCancel.status, battleStatus: pkCancel.body?.battle?.status });

  // ── P73-2: the trending shelf (engagement now exists) ──
  await viewerPage.goto(`${BASE}/live`, { waitUntil: "domcontentloaded" });
  await viewerPage.waitForSelector('[data-testid="live-trending"]', { timeout: 20_000 });
  fact(14, "trendingAfterEngagement", "live-trending visible");
  await shot(viewerPage, "15-trending-shelf");

  // ── P73-3: the bell's go-live row + the deep link ──
  await viewerPage.click('[aria-label^="Notifications"]');
  await viewerPage.waitForSelector('text=Parity Host is live', { timeout: 15_000 });
  fact(15, "bellGoLiveRow", "the 'Parity Host is live' row rendered");
  await shot(viewerPage, "16-bell-go-live");
  const notifProbe = await api(viewerPage, "/api/notifications");
  const liveItem = (notifProbe.body?.items ?? []).find((n) => n.liveRoomId === roomId);
  fact(15, "notificationApiRow", liveItem ? { kind: liveItem.kind, liveRoomId: liveItem.liveRoomId } : null);

  // ── Mobile 375 honesty ──
  const mobilePage = await viewerCtx.newPage();
  await mobilePage.setViewportSize({ width: 375, height: 720 });
  await mobilePage.goto(`${BASE}/live/${roomId}`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForSelector('[data-testid="live-room-viewer"]', { timeout: 30_000 });
  const overflow = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  fact(16, "mobile375OverflowPx", overflow);
  await shot(mobilePage, "17-mobile-375");
  await mobilePage.close();

  // ── End the broadcast (the honest confirm) ──
  await hostPage.click('[data-testid="live-console-end"]');
  await hostPage.getByRole("button", { name: "End live" }).click();
  await hostPage.waitForSelector('[data-testid="live-ended-summary"]', { timeout: 30_000 });
  fact(17, "ended", "live-ended-summary visible");
  await shot(hostPage, "18-ended-summary");

  // ── DB-verified durable facts ──
  const dbFacts = JSON.parse(
    execSync(
      `bun -e '
import { db } from "./src/lib/db";
const room = await db.liveRoom.findUnique({ where: { id: "${roomId}" } });
const goal = await db.liveRoomGoal.findFirst({ where: { roomId: "${roomId}" }, orderBy: { createdAt: "desc" } });
const pin = await db.livePinnedMessage.findUnique({ where: { roomId: "${roomId}" } });
const fresh = await db.liveRoom.findUnique({ where: { id: "${roomId}" }, select: { announcementBody: true, announcementUpdatedAt: true, blockLinks: true } });
const keywords = await db.liveRoomKeyword.findMany({ where: { roomId: "${roomId}" }, select: { pattern: true } });
const notifs = await db.notification.findMany({ where: { liveRoomId: "${roomId}" }, select: { userId: true, kind: true, read: true } });
const pk = await db.livePkBattle.findFirst({ where: { roomAId: "${roomId}" }, orderBy: { createdAt: "desc" } });
const ledger = await db.liveModerationAction.findMany({ where: { roomId: "${roomId}", action: { in: ["pin", "keyword-add"] } }, select: { action: true } });
console.log(JSON.stringify({
  roomStatus: room?.status,
  goal: goal ? { kind: goal.kind, target: goal.target, status: goal.status, reachedAt: goal.reachedAt } : null,
  pin: pin ? { messageId: pin.messageId } : null,
  announcement: fresh ? { body: fresh.announcementBody, updatedAt: fresh.announcementUpdatedAt } : null,
  keywords: keywords.map((k) => k.pattern),
  notifications: notifs.length,
  pk: pk ? { status: pk.status, winnerSide: pk.winnerSide } : null,
  ledgerKinds: ledger.map((l) => l.action),
}));
'`,
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "file:/home/z/webflix-2.0/db/webflix2.db" },
      },
    ),
  );
  fact(18, "dbFacts", dbFacts);
  fact(19, "consoleErrors", { host: hostErrors, viewer: viewerErrors });

  facts.finishedAt = new Date().toISOString();
  writeFileSync(`${OUT}/acceptance-facts.json`, JSON.stringify(facts, null, 2));
  console.log(`evidence written to ${OUT}/acceptance-facts.json`);
  await browser.close();
}

main().catch((err) => {
  facts.fatal = String(err?.stack ?? err);
  try {
    writeFileSync(`${OUT}/acceptance-facts.json`, JSON.stringify(facts, null, 2));
  } catch {}
  console.error("FATAL", err);
  process.exit(1);
});

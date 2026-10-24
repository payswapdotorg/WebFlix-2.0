/**
 * WebFlix Bridge — the MV3 service worker.
 *
 * Watches the .netflix.com cookie jar of the browser the operator actually
 * signs into (their real browser, their real IP — the risk engine never sees
 * automation because there is none) and pushes the session to the operator's
 * own WebFlix server on rotation. NetflixId/SecureNetflixId are HttpOnly:
 * document.cookie can never read them, chrome.cookies can.
 */
import { cookieSignature, decidePush, toBridgeCookies } from "./logic.js";

const KEEPALIVE_ALARM = "webflix-bridge-keepalive";

async function cfg() {
  const { baseUrl = "", token = "" } = await chrome.storage.sync.get(["baseUrl", "token"]);
  return { baseUrl: String(baseUrl).replace(/\/+$/, ""), token: String(token).trim() };
}

async function setState(patch) {
  await chrome.storage.local.set({ state: { ...(await state()), ...patch, at: Date.now() } });
}

async function state() {
  return (await chrome.storage.local.get("state")).state ?? {};
}

function setStatus(status, detail) {
  return setState({ status, detail: detail ?? null });
}

/** The whole point of the extension: capture + push. */
export async function maybePush({ force = false } = {}) {
  const { baseUrl, token } = await cfg();
  if (!baseUrl || !token) {
    await setStatus("unconfigured", "Set the WebFlix URL and pairing token in Options.");
    return;
  }
  const jar = await chrome.cookies.getAll({ domain: "netflix.com" });
  const cookies = toBridgeCookies(jar);
  const signature = cookieSignature(cookies);
  const st = await state();
  const decision = force
    ? { push: true, reason: "manual" }
    : decidePush({
        signature,
        lastSignature: st.lastSignature ?? null,
        lastPushAt: st.lastPushAt ?? null,
        now: Date.now(),
      });
  if (!decision.push) {
    await setStatus(
      decision.reason === "no-auth" ? "signed-out" : "watching",
      decision.reason === "no-auth"
        ? "No NetflixId here yet — sign into netflix.com in this browser."
        : `Session current (last push ${st.lastPushAt ? new Date(st.lastPushAt).toLocaleString() : "—"}).`,
    );
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/api/netflix/watch/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        cookies,
        device: (navigator.userAgent || "unknown browser").slice(0, 120),
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok) {
      await setState({
        lastSignature: signature,
        lastPushAt: Date.now(),
        status: out.applied ? "applied" : "queued",
        detail: out.message ?? null,
      });
    } else if (res.status === 401) {
      await setStatus("bad-token", "The pairing token was rejected — re-paste it from the WebFlix auto sign-in panel.");
    } else {
      await setStatus("rejected", out.message ?? `WebFlix answered ${res.status}.`);
    }
  } catch (e) {
    await setStatus("unreachable", `Could not reach ${baseUrl} — will retry on the next rotation. (${String(e).slice(0, 80)})`);
  }
}

// cookie changes on .netflix.com → debounced push (Netflix rotates NetflixId
// on the client periodically; every rotation is shipped automatically)
let debounceTimer = null;
chrome.cookies.onChanged.addListener((change) => {
  if (!change.cookie || !/\.?netflix\.com$/.test(change.cookie.domain || "")) return;
  if (!["NetflixId", "SecureNetflixId"].includes(change.cookie.name)) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void maybePush(), 3000);
});

// keepalive: re-assert the session to WebFlix twice a day even without rotation
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === KEEPALIVE_ALARM) void maybePush();
});

// service worker wake-up (MV3 workers are ephemeral) — a fresh chance to push
void maybePush();

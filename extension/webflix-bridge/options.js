const $ = (id) => document.getElementById(id);
const status = $("status");

async function refreshState() {
  const { state } = await chrome.storage.local.get("state");
  if (state) {
    status.textContent = `Bridge status: ${state.status ?? "idle"}\n${state.detail ?? ""}${
      state.lastPushAt ? `\nLast push: ${new Date(state.lastPushAt).toLocaleString()}` : ""
    }`;
  }
}

const { baseUrl = "", token = "" } = await chrome.storage.sync.get(["baseUrl", "token"]);
$("baseUrl").value = baseUrl;
$("token").value = token;
void refreshState();

$("save").addEventListener("click", async () => {
  const origin = $("baseUrl").value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/.test(origin)) {
    status.textContent = "Enter the full WebFlix URL (https://… or http://…).";
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      status.textContent = "Permission to reach that WebFlix was denied — the bridge cannot push there.";
      return;
    }
  } catch (e) {
    status.textContent = `Permission request failed: ${e}`;
    return;
  }
  await chrome.storage.sync.set({ baseUrl: origin, token: $("token").value.trim() });
  status.textContent = "Saved. The bridge will push automatically from now on — open netflix.com and make sure you are signed in.";
  chrome.runtime.sendMessage({ type: "webflix-bridge-push-now" }).catch(() => {});
});

$("test").addEventListener("click", async () => {
  const origin = $("baseUrl").value.trim().replace(/\/+$/, "");
  status.textContent = "Testing…";
  try {
    const res = await fetch(`${origin}/api/netflix/watch/autoauth`, { method: "GET" });
    status.textContent = res.ok
      ? "Connection OK — WebFlix is reachable."
      : `WebFlix answered ${res.status} — check the URL.`;
  } catch (e) {
    status.textContent = `Could not reach ${origin} — check the URL. (${String(e).slice(0, 100)})`;
  }
});

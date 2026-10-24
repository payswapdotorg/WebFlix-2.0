const $ = (id) => document.getElementById(id);

const OK_STATES = new Set(["applied", "queued", "watching"]);
const BAD_STATES = new Set(["bad-token", "unreachable", "unconfigured", "signed-out"]);

async function refresh() {
  const { state } = await chrome.storage.local.get("state");
  const s = state?.status ?? "idle";
  $("detail").textContent =
    `${s}\n${state?.detail ?? "Open Options to pair this bridge with WebFlix."}` +
    (state?.lastPushAt ? `\nLast push: ${new Date(state.lastPushAt).toLocaleString()}` : "");
  $("dot").className = `dot ${OK_STATES.has(s) ? "ok" : BAD_STATES.has(s) ? "bad" : "warn"}`;
}
void refresh();

$("push").addEventListener("click", async () => {
  $("detail").textContent = "Pushing…";
  try {
    const { maybePush } = await import("./background.js");
    await maybePush({ force: true });
  } catch (e) {
    $("detail").textContent = `Push failed: ${e}`;
    return;
  }
  await refresh();
});

$("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

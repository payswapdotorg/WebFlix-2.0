import View from "./view";

export const metadata = { title: "WebFlix LIVE — Operations" };

/**
 * WFX2-LIVE-PLATFORM-1 Phase 4-OPS — the §4H operations dashboard shell
 * (ADR-0009). Deliberately NOT in the consumer navigation: an ops console
 * is operator-reachable by URL, and every access resolves through the
 * fail-closed ops-admin gate (WEBFLIX_OPS_ADMIN_EMAILS) inside ./view.tsx —
 * signed-out and non-admin visitors get the honest gate states, never a
 * fake empty dashboard.
 */
export default function Page() {
  return <View />;
}

import View from "./view";

export const metadata = { title: "Send feedback" };

/**
 * WFX2-P5-SS — the send-feedback page shell. The client form lives in
 * ./view.tsx; submissions land in the local capture endpoint
 * (src/app/api/feedback/route.ts) — local storage, honest disclosure.
 */
export default function Page() {
  return <View />;
}

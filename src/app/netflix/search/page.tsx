import View from "./view";

export const revalidate = 3600;

export const metadata = {
  title: "Search Netflix — WebFlix",
  description:
    "Search Netflix's official Top 10 & Most Popular universe from inside WebFlix, then play through Netflix's own player.",
};

/**
 * P50 — the in-hub Netflix search page (ISR shell; the client view resolves
 * the query). Netflix's own nav carries a search box — WebFlix's Netflix hub
 * now does too, answered by the same honest Top-10 mirror the hub browses.
 */
export default function Page() {
  return <View />;
}

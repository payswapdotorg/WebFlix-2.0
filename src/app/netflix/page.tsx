import View from "./view";

export const revalidate = 3600;

export const metadata = {
  title: "Netflix on WebFlix",
  description:
    "Browse Netflix's official Top 10 and Most Popular titles, build your list, and play through Netflix's own player.",
};

/**
 * P42 — ISR shell (the house pattern): static chrome, hourly revalidate, all
 * data client-fetched from the dynamic /api/netflix routes.
 */
export default function Page() {
  return <View />;
}

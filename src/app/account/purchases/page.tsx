import View from "./view";

export const revalidate = 3600;

export const metadata = { title: "Purchases & memberships" };

/**
 * WFX2-P5-YA — ISR shell (the /playlists idiom); the client surface lives in
 * ./view.tsx behind the personal-surface gate.
 */
export default function Page() {
  return <View />;
}

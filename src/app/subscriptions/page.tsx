import View from "./view";

export const revalidate = 3600;

export const metadata = { title: "Subscriptions" };

/**
 * WFX2-C-W — ISR shell: the page chrome (sidebar nav, category chips, topbar
 * skeleton) is static and revalidated hourly; every datum stays client-fetched
 * from the dynamic /api routes (force-dynamic stays there by law). The client
 * surface itself lives in ./view.tsx.
 */
export default function Page() {
  return <View />;
}

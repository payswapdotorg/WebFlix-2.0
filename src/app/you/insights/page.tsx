import View from "./view";

export const revalidate = 3600;

export const metadata = { title: "Watch insights" };

/**
 * WFX2-P7-AN — ISR shell (the /you idiom): the page chrome is static and
 * revalidated hourly; every datum stays client-fetched from the dynamic
 * /api/watch/insights route. The client surface lives in ./view.tsx.
 */
export default function Page() {
  return <View />;
}

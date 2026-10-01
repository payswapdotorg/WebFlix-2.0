import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Studio" };

/**
 * WFX2-P2-ST — youtube.com/studio redirects to studio.youtube.com; WebFlix
 * matches: the standalone Creator Studio (apps/studio, deployed at
 * studio-webflix.vercel.app) owns the creator surfaces now. The embedded
 * studio page it replaces lives on in git history (phase-1 WFX2-C-B/C-W).
 *
 * STUDIO_APP_URL overrides the target (dev parity: point it at a local
 * apps/studio dev server); default = the production deployment.
 */
export default function Page() {
  redirect(process.env.STUDIO_APP_URL ?? "https://studio-webflix.vercel.app");
}

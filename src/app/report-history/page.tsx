import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { SignedOutScreen } from "@/components/auth/signed-out-screen";
import { listMyVideoReports } from "./queries";
import { ReportHistoryView } from "./view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report history" };

/**
 * WFX2-P5-SS — the report-history page.
 *
 * youtube.com's report history is a personal surface, so the AU guest law
 * applies: guests get the signed-out screen. Signed-in users see the honest
 * split — the locally recorded video reports (the real VideoReport rows)
 * plus the not-available truths for comment reports and YouTube's own
 * report history (see ./view.tsx).
 */
export default async function ReportHistoryPage() {
  const requestHeaders = await headers();
  const user = await getSessionUser(
    new Request("http://localhost/report-history", {
      headers: Object.fromEntries(requestHeaders.entries()),
    }),
  );

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <SignedOutScreen
          title="Your report history"
          message="Sign in to see the reports you've made on WebFlix."
          redirect="/report-history"
        />
      </main>
    );
  }

  const reports = await listMyVideoReports(user.id);
  return <ReportHistoryView reports={reports} />;
}

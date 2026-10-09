import { format } from "date-fns";
import Link from "next/link";
import { Clock, SearchCheck } from "lucide-react";
import type { ReportedVideoRow } from "./queries";

/**
 * WFX2-P20 — the report-history surface at youtube.com's report-history
 * layout depth (presentational; the server page resolves the session and
 * runs the verified local query).
 *
 * YouTube's structure, mirrored:
 *   - an intro line in YouTube's wording ("Thanks for reporting"),
 *   - a list of report entries — each entry: reported-content summary
 *     (thumbnail + title), reason category, timestamp, and a status chip
 *     in YouTube's states (Under review / Resolved),
 *   - the empty state and the disclosures below.
 *
 * Honest split, stated on the page (unchanged doctrine, deepened):
 *   1. Reports you make on VIDEOS in WebFlix → the local moderation review
 *      queue — listed here (the real VideoReport rows).
 *   2. Reports you make on COMMENTS → submitted through the operator's
 *      YouTube session; no local record, nothing to list.
 *   3. YouTube's own report history (youtube.com/report/history) → NOT
 *      available through WebFlix; link out, never a fake list.
 *
 * Honest status chips: every local row carries "Under review" — the local
 * moderation queue has no resolution step, so no row ever shows YouTube's
 * "Resolved" state locally. YouTube's entries move from Under review to
 * Resolved; those resolutions are only visible on youtube.com itself
 * (disclosed below the list).
 */
export function ReportHistoryView({ reports }: { reports: ReportedVideoRow[] }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Report history</h1>
      <p data-report-history-intro className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Thanks for reporting — see the status of the reports you've made. Reports you make on
        videos in WebFlix are listed below; comment reports and YouTube's own report history
        are YouTube-side (both disclosed under the list).
      </p>

      <section
        data-report-history-local
        className="mt-6 rounded-xl border border-border p-5"
        aria-label="Your WebFlix video reports"
      >
        <h2 className="text-base font-semibold">Reports you've made on WebFlix</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reporting a video from its menu sends it to WebFlix's moderation review queue (the
          video stays visible, matching youtube.com) and records a local row — your reports are
          listed here.
        </p>

        {reports.length === 0 ? (
          <div
            data-report-history-empty
            className="mt-4 rounded-lg border border-dashed border-border p-8 text-center"
          >
            <SearchCheck
              aria-hidden="true"
              className="mx-auto size-8 text-muted-foreground/60"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              You haven't reported any videos on WebFlix yet. Reports you make from a video's
              report dialog will appear here.
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {reports.map((report) => (
              <li
                key={report.id}
                data-report-item={report.video.id}
                className="flex items-center gap-4 rounded-lg border border-border p-3"
              >
                <Link href={`/watch/${report.video.id}`} className="shrink-0">
                  <img
                    src={report.video.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-12 w-20 rounded object-cover"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/watch/${report.video.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {report.video.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Reported for {report.reason}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock aria-hidden="true" className="size-3" />
                    <time dateTime={report.createdAt.toISOString()}>
                      Reported {format(report.createdAt, "MMM d, yyyy")}
                    </time>
                  </p>
                </div>
                <span
                  data-report-status="under-review"
                  className="shrink-0 rounded-full border border-border bg-secondary/40 px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  Under review
                </span>
              </li>
            ))}
          </ul>
        )}

        <p data-report-history-states className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Statuses follow YouTube's report states — Under review, then Resolved when the review
          completes. WebFlix's local queue rows stay Under review (there is no local resolution
          step), and resolutions of reports made through the operator's YouTube session are
          only visible on YouTube itself.
        </p>
      </section>

      <section
        data-report-history-comments
        className="mt-4 rounded-xl border border-border p-5"
        aria-label="Comment reports"
      >
        <h2 className="text-base font-semibold">Comment reports</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Reporting a comment from its ⋮ menu submits the report through the operator's YouTube
          session — the same session behind every account action in WebFlix. Comment reports
          leave no local record, so there is nothing to list here.
        </p>
      </section>

      <section
        data-report-history-youtube
        className="mt-4 rounded-xl border border-border p-5"
        aria-label="YouTube report history"
      >
        <h2 className="text-base font-semibold">YouTube's report history</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          YouTube's report history is not available through WebFlix — WebFlix has no verified way
          to read it back, and we won't show a fake list. Reports made through the operator
          account are visible on YouTube itself:
        </p>
        <a
          href="https://www.youtube.com/report/history"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-yt-red hover:underline"
        >
          Open YouTube's report history (youtube.com/report/history) ↗
        </a>
      </section>
    </main>
  );
}

export default ReportHistoryView;

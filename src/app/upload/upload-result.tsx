"use client";

import { CheckCircle2, ExternalLink, AlertTriangle, CloudOff, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadExecuteResponseDTO } from "@/lib/upload/flow";

/**
 * WFX2-P3-UP — the upload flow's terminal result card (pure presentational;
 * the view feeds it the /api/upload/execute outcome, the tests render it under
 * happy-dom). Honest by construction: the published card only appears for a
 * broker-confirmed publish (deep-linking the REAL video), the unverified
 * publish says exactly that, the fallback card carries the CURRENT hand-off
 * rung, and the error card shows the broker's stage-accurate message —
 * never a fake success.
 */

const STAGE_LABELS: Record<string, string> = {
  dialog: "opening the upload dialog",
  details: "filling the details step",
  checks: "running the checks steps",
  visibility: "setting visibility",
  uploading: "uploading",
  processing: "processing",
  publishing: "publishing",
  navigating: "navigating to the upload page",
};

export function stageLabel(stage?: string): string | null {
  return stage ? STAGE_LABELS[stage] ?? stage : null;
}

function HandoffBundle(props: {
  bundle: string;
  handoffUrl: string;
  onCopy: () => void;
  copied: boolean;
}): React.JSX.Element {
  return (
    <div className="mt-3">
      <p className="text-sm text-muted-foreground">
        Copy the metadata bundle into{" "}
        <a
          href={props.handoffUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2"
        >
          YouTube&apos;s upload page <ExternalLink className="inline size-3.5" aria-hidden="true" />
        </a>{" "}
        — YouTube owns the upload there.
      </p>
      <textarea
        readOnly
        rows={8}
        value={props.bundle}
        aria-label="Upload metadata bundle (copy and paste into YouTube's upload form)"
        className="mt-2 w-full rounded-xl border border-border bg-secondary/40 p-4 font-mono text-xs leading-relaxed"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="mt-2 flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="rounded-full" onClick={props.onCopy}>
          {props.copied ? "Bundle copied" : "Copy bundle"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => window.open(props.handoffUrl, "_blank", "noopener,noreferrer")}
        >
          Open upload page <ExternalLink className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default function UploadResultCard(props: {
  result: UploadExecuteResponseDTO;
  onCopyBundle: () => void;
  copied: boolean;
}): React.JSX.Element {
  const { result } = props;
  if (result.outcome === "published") {
    const unverified = result.verified !== true;
    return (
      <section
        aria-live="polite"
        className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 sm:p-5"
        data-testid="upload-published-card"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {unverified ? (
            <Clock className="size-5 text-amber-500" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
          )}
          {unverified ? "Publish clicked — confirmation not observed" : "Video published"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {unverified
            ? (result.note ?? "The publish button was clicked; the confirmation was not observed in the operator tab — the video may still be processing.")
            : "The upload was published and verified in the operator's logged-in YouTube tab."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => window.open(result.watchUrl, "_blank", "noopener,noreferrer")}
          >
            Open the video <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
          <a
            href={result.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground underline underline-offset-2"
          >
            {result.watchUrl}
          </a>
          {result.videoId ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {result.videoId}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Tags, thumbnail and the Short flag are hand-off fields — the broker drive fills title,
          description and visibility; add the rest in YouTube Studio.
        </p>
      </section>
    );
  }
  if (result.outcome === "fallback") {
    return (
      <section
        aria-live="polite"
        className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 sm:p-5"
        data-testid="upload-fallback-card"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CloudOff className="size-5 text-amber-500" aria-hidden="true" />
          The session broker is offline — handing off instead
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.message ??
            "The broker could not be reached; nothing was uploaded. The hand-off below is the honest path."}
        </p>
        {result.handoff ? (
          <HandoffBundle
            bundle={result.handoff.bundle}
            handoffUrl={result.handoff.handoffUrl}
            onCopy={props.onCopyBundle}
            copied={props.copied}
          />
        ) : null}
      </section>
    );
  }
  const stageText = stageLabel(result.stage);
  return (
    <section
      aria-live="polite"
      className="mt-6 rounded-xl border border-red-500/40 bg-red-500/5 p-4 sm:p-5"
      data-testid="upload-error-card"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <AlertTriangle className="size-5 text-red-500" aria-hidden="true" />
        The publish was not completed
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {result.message ?? "The broker refused the publish — nothing is claimed."}
        {stageText ? (
          <span className="block mt-1">
            The drive stopped while {stageText} (stage: <code className="font-mono text-xs">{result.stage}</code>).
          </span>
        ) : null}
      </p>
      {result.handoff ? (
        <HandoffBundle
          bundle={result.handoff.bundle}
          handoffUrl={result.handoff.handoffUrl}
          onCopy={props.onCopyBundle}
          copied={props.copied}
        />
      ) : null}
    </section>
  );
}

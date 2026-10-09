"use client";

import { useState, type FormEvent } from "react";
import { Camera, Info } from "lucide-react";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_NOTE,
  FEEDBACK_DISCLOSURE,
  FEEDBACK_LEGAL_NOTICE,
  FEEDBACK_SCREENSHOT_DISCLOSURE,
  MAX_FEEDBACK_LENGTH,
} from "./shared";

/**
 * WFX2-P20 — the send-feedback form at YouTube's real structure depth:
 *
 *   - the category select over YouTube's ACTUAL feedback-tool list
 *     (mirrored verbatim, provenance disclosed),
 *   - the description textarea with the live character count,
 *   - the screenshot-attach row — YouTube's real row, honestly absent:
 *     no checkbox, no file input, no fake capture; the disclosure says
 *     exactly why,
 *   - the legal notice line — YouTube's "Some account and system
 *     information may be sent to…" wording, honestly adapted to WebFlix's
 *     text-only local store,
 *   - submit → the existing /api/feedback local capture, with the success
 *     state in YouTube's confirmation wording on top of the honest copy.
 *
 * Honest delivery model (unchanged from P5-SS): submissions are stored
 * locally for the WebFlix operator — never posted to YouTube — and the
 * page discloses it before submission and after success.
 */
export function FeedbackView() {
  const [category, setCategory] = useState<string>(FEEDBACK_CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_FEEDBACK_LENGTH - message.length;
  const canSubmit = status !== "sending" && message.trim().length > 0 && remaining >= 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: message.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The capture endpoint returned ${res.status}.`);
      }
      setStatus("sent");
      setMessage("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Something went wrong sending your feedback.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Send feedback</h1>

      <p
        data-feedback-disclosure
        className="mt-3 rounded-xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed text-muted-foreground"
      >
        {FEEDBACK_DISCLOSURE} We read what lands here, but we can't reply individually.
      </p>

      {status === "sent" ? (
        <div
          data-feedback-sent
          className="mt-6 rounded-xl border border-border p-5"
          role="status"
        >
          <h2 className="text-base font-semibold">Thanks for your feedback!</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Thanks — your feedback was saved. It's stored on this WebFlix server's local store
            for the operator to read. {FEEDBACK_DISCLOSURE}
          </p>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="mt-3 text-sm font-medium text-yt-red hover:underline"
          >
            Send more feedback
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2 text-sm font-medium">
            <label htmlFor="feedback-category">Feedback Type</label>
            <select
              id="feedback-category"
              aria-label="Feedback Type"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="max-w-sm rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {FEEDBACK_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span
              data-feedback-category-note
              className="text-xs font-normal leading-relaxed text-muted-foreground"
            >
              {FEEDBACK_CATEGORY_NOTE}
            </span>
          </div>

          <label className="flex flex-col gap-2 text-sm font-medium">
            Describe your issue
            <textarea
              aria-label="Describe your issue"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={MAX_FEEDBACK_LENGTH}
              placeholder="What happened, and where in WebFlix did it happen?"
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span data-feedback-char-count className="text-xs font-normal text-muted-foreground">
              {remaining} characters left
            </span>
          </label>

          {/* YouTube's screenshot-attach row — present in structure, honestly absent in capability */}
          <div
            data-feedback-screenshot-row
            className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4"
          >
            <Camera aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Include screenshot</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {FEEDBACK_SCREENSHOT_DISCLOSURE}
              </p>
            </div>
          </div>

          {/* YouTube's legal notice line, honestly adapted */}
          <p
            data-feedback-legal
            className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
          >
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {FEEDBACK_LEGAL_NOTICE}
          </p>

          {error ? (
            <p role="alert" className="text-sm text-yt-red">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-fit rounded-full bg-yt-red px-6 py-2 text-sm font-medium text-white transition hover:bg-yt-red/90 disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send feedback"}
          </button>
        </form>
      )}
    </main>
  );
}

export default FeedbackView;

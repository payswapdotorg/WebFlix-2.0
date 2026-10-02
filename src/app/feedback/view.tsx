"use client";

import { useState, type FormEvent } from "react";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_DISCLOSURE,
  MAX_FEEDBACK_LENGTH,
} from "./shared";

/**
 * WFX2-P5-SS — the send-feedback form. Submits to the local capture endpoint
 * (/api/feedback), which appends to the server's local store. The page
 * discloses the honest delivery model up front and after success: stored for
 * the WebFlix operator, never posted to YouTube. Text-only by choice — no
 * screenshot affordance that would pretend to attach anything.
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
          <h2 className="text-base font-semibold">Thanks — your feedback was saved.</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            It's stored on this WebFlix server's local store for the operator to read.{" "}
            {FEEDBACK_DISCLOSURE}
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
          <label className="flex flex-col gap-2 text-sm font-medium">
            What's it about?
            <select
              aria-label="Feedback category"
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
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            Your feedback
            <textarea
              aria-label="Feedback message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={MAX_FEEDBACK_LENGTH}
              placeholder="What happened, and where in WebFlix did it happen?"
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs font-normal text-muted-foreground">
              {remaining} characters left
            </span>
          </label>

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

/**
 * P52 — the serialized-work primitive for the netflix-desktop session.
 *
 * WHY (P51-AUDIT A3, the broker-side half): the restart route fire-and-
 * forgets `destroy()` while the UI immediately re-kicks `/session` —
 * `ensure()` could adopt a dying sandbox (its `desktop` handle still set
 * mid-kill) or a late `resetLocal()` could null a freshly-bootstrapped
 * desktop. The app-side busy-gating (P51) covers the button; this covers
 * the BROKER: every teardown AND every bootstrap runs through one serial
 * queue, so a bootstrap can never interleave with a teardown, and two
 * teardowns can never interleave with each other.
 *
 * Pure and dependency-free on purpose: the app's test battery imports it
 * directly (tests/netflix-broker-mutex.test.ts) — no @e2b/desktop needed.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    /**
     * Enqueue `job` after everything already queued. The job runs even if a
     * prior job failed; its own rejection propagates to ITS caller only —
     * the queue itself never stays broken.
     */
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job, job);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    /** Resolves when every job queued so far has settled (success or failure). */
    drain(): Promise<void> {
      const flushed = tail;
      return flushed.then(
        () => undefined,
        () => undefined,
      );
    },
  };
}

export type SerialQueue = ReturnType<typeof createSerialQueue>;

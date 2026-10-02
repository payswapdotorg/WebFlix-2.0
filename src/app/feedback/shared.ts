/**
 * WFX2-P5-SS — feedback constants shared by the /feedback page and the
 * /api/feedback capture route (kept in one place so they can never drift).
 */

export const FEEDBACK_CATEGORIES = [
  "General",
  "Search",
  "Watch & player",
  "Queue & playlists",
  "Settings",
  "Something's broken",
  "Other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const MAX_FEEDBACK_LENGTH = 4000;

/** The honesty law — displayed before submission, repeated after, asserted by the tests. */
export const FEEDBACK_DISCLOSURE =
  "Feedback is stored locally for the WebFlix operator to read. It does not post to YouTube.";

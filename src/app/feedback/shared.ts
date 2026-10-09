/**
 * WFX2-P5-SS — feedback constants shared by the /feedback page and the
 * /api/feedback capture route (kept in one place so they can never drift).
 */

/**
 * WFX2-P20 — YouTube's actual feedback-tool category list, mirrored
 * verbatim. This is the "Feedback Type" select from YouTube's own
 * send-feedback form (youtube.com/tv/feedback — the one YouTube surface
 * with a real, readable category list), preserved exactly as YouTube
 * labels it, including the capitalization inconsistencies ("Video
 * Playback - ..." vs "Video playback - ...") and the TV/app-specific
 * entries (Casting, App freezing). Mirroring exactly is the honest
 * default — trimming YouTube's list to what "fits" WebFlix would be a
 * quieter lie than showing YouTube's real categories.
 */
export const FEEDBACK_CATEGORIES = [
  "General Feedback",
  "Video Playback - Video doesn't play",
  "Video Playback - Video is poor quality",
  "Video Playback - Buffering",
  "Video Playback - Audio not working",
  "Video Playback - Poor audio quality",
  "Video Playback - Seeing a black screen",
  "Video playback - Seeing a green screen",
  "Video playback - Can't fast forward or rewind",
  "Video playback - Captions not working",
  "Video playback - Can't skip ad",
  "Video playback - Seeing ad with Premium",
  "Video playback - Autoplay not working",
  "Video playback - Other",
  "App is freezing",
  "App is crashing",
  "Casting - Can't connect",
  "Casting - Video doesn't cast",
  "Accounts - Can't sign in",
  "Accounts - Signed out unexpectedly",
  "Accounts - Can't switch account",
  "Search - Can't search",
  "Search - Voice search isn't working",
  "Feature request - Want to post and view comments",
  "Feature request - Want HD or 4K video quality support",
  "Feature request - Want to control playback speed",
  "Feature request - Want to live stream from device",
  "Feature request - Want to download videos",
  "Feature request - Want to block a channel",
  "Feature request - Other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const MAX_FEEDBACK_LENGTH = 4000;

/** The honesty law — displayed before submission, repeated after, asserted by the tests. */
export const FEEDBACK_DISCLOSURE =
  "Feedback is stored locally for the WebFlix operator to read. It does not post to YouTube.";

/**
 * WFX2-P20 — the category list's provenance, stated on the page: the list
 * is YouTube's real feedback-tool list, mirrored exactly (honest-absence —
 * never a curated "WebFlix-safe" subset pretending to be YouTube's).
 */
export const FEEDBACK_CATEGORY_NOTE =
  "This is YouTube's own feedback-tool category list (the Feedback Type list from YouTube's send-feedback form), mirrored exactly — TV and app categories included. Your report is triaged locally with these labels; it never leaves this server.";

/**
 * WFX2-P20 — the legal notice line, YouTube's wording honestly adapted.
 * YouTube's feedback dialog reads "Some account and system information
 * may be sent to Google. We will use it to fix problems and improve our
 * services…". WebFlix's store has no Google delivery and no system-data
 * capture — the line says what actually happens instead of implying
 * YouTube's pipeline.
 */
export const FEEDBACK_LEGAL_NOTICE =
  "Some account and system information may be sent to the WebFlix operator. We will use it to fix problems and improve WebFlix — but only what you type here: the store is text-only on this server, and nothing is sent to Google. (YouTube's own feedback tool sends this information to Google; WebFlix's does not.)";

/**
 * WFX2-P20 — the screenshot-attach row's honest-absence disclosure.
 * YouTube's tool attaches a screenshot of the current page; WebFlix's
 * store accepts text only. The row shows YouTube's real structure with
 * this disclosure instead of a fake attach affordance.
 */
export const FEEDBACK_SCREENSHOT_DISCLOSURE =
  "Screenshot capture is a YouTube-only feature — YouTube's feedback tool attaches the page you're on. WebFlix's feedback store is text-only, so there is no screenshot to attach here: describe what you saw in the description box instead.";

/**
 * The shadow identity derivation — the stable bridge id between a WebFlix
 * account and its local authorship rows (`wf-<sessionUserId>`).
 *
 * Client-safe by law: a pure function, no db import — the client (e.g. the
 * watch-party chat's own-row check) and the server derive the SAME id from
 * the SAME session, so ownership matches across the seam.
 */
export function shadowUserId(sessionUserId: string): string {
  return `wf-${sessionUserId}`;
}

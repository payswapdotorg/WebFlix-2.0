/**
 * WFX2-P3-LC — the live-chat-send kind module (THIS FILE IS THE P3-LC
 * LANE'S EXCLUSIVE TERRITORY; the shared registry — types.ts kinds array +
 * executor.ts routing — was pre-seeded by the lead on main so the lane
 * never edits a shared file).
 *
 * The send (the lane implements): with the tab on the live watch URL, type
 * the message into the real live-chat composer (yt-live-chat-text-input-
 * field-renderer), press Enter, verify the message appears in the chat
 * stream — honest error states for member-only chat, slow mode, and chat
 * disabled.
 */

const RUNNER = `const R=(s)=>s&&(s.__exception?{__exception:s.__exception}:s);
try{`;

const script = (body: string): string => `(async()=>{${RUNNER}${body}}catch(e){return{__exception:String(e)}}})()`;

/**
 * STUB (pre-seeded by the lead on main — the P3-LC lane replaces this body).
 * Honest staged-kind response until the lane lands.
 */
export function liveChatSendScript(message: string): {
  script: string;
  timeoutMs: number;
} {
  return {
    script: script(`
return R({ok:false,
  error:'live-chat-send: staged kind — executor pending the P3-LC lane',
  path:'none',
  detail:${JSON.stringify({ staged: true, messageLen: message.length })}});
`),
    timeoutMs: 5000,
  };
}

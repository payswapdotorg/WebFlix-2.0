/**
 * WFX2-P3-LC — the live-chat report action (the chat-message report lane).
 *
 * On youtube.com, reporting a live-chat message rides the platform's own
 * chat affordance: hover / right-click the message row → the ⋮ context menu
 * → Report → YouTube's report dialog INSIDE the chat surface. Driving that
 * flow needs a `live-chat-report` broker kind (a page script that locates
 * the chat row, opens its context menu and walks the chat report dialog in
 * the logged-in tab).
 *
 * That kind is NOT in the broker registry yet — types.ts (the ACTION_KINDS
 * array) and executor.ts (the routing) are lead-owned shared files this lane
 * may not edit. So this action NEVER claims a report was filed: it returns
 * the honest unavailable state and the UI shows it verbatim (the established
 * honest-degradation law — a fake "reported" state is worse than none).
 *
 * THE SEAM (for the lead): register `live-chat-report` in types.ts + route
 * it in executor.ts buildScript to a page script in this lane's
 * kinds/livechat.ts (chat-row locate → context menu → report dialog), then
 * swap this function's body for the brokerLiveChatReport call.
 */

export interface LiveChatReportInput {
  videoId: string;
  /** the chat message's youtube.com id (the row's element id) */
  messageId: string;
  /** the message's current text — the DOM locator for the chat row */
  body: string;
  /** one of YouTube's report-dialog reason labels */
  reason?: string;
}

export interface LiveChatReportResult {
  ok: boolean;
  /** the honest outcome copy (never a fake "reported" claim) */
  message: string;
  reason?: string;
}

export const LIVE_CHAT_REPORT_UNAVAILABLE =
  "Chat reports go through YouTube's own chat report flow. The broker lane can't drive that chat dialog yet — nothing was filed.";

/**
 * Report a live chat message. HONEST DEGRADATION: until the
 * `live-chat-report` broker kind lands (the lead-owned registry seam above),
 * this answers with the honest unavailable state — the UI surfaces it and
 * never pretends the report was filed.
 */
export async function reportLiveChatMessage(
  input: LiveChatReportInput
): Promise<LiveChatReportResult> {
  // The future transport (kept explicit so the seam is a one-line swap):
  //   const r = await brokerLiveChatReport(input.videoId, input.messageId, {
  //     messageText: input.body, reason: input.reason,
  //   });
  void input;
  return {
    ok: false,
    message: LIVE_CHAT_REPORT_UNAVAILABLE,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

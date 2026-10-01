/**
 * WFX2-P3-UP — the upload drive's broker wiring: the navigate→re-invoke
 * ladder around brokerUploadExecute.
 *
 * The staged drive's script OWNS its navigation (requiredUrl is null for the
 * kind), and a single Runtime.evaluate cannot survive its own cross-document
 * navigation — so the first invocation lands the tab on
 * https://www.youtube.com/upload and returns the honest intermediate
 * {detail:{stage:'navigating'}}. This loop waits for the landing and
 * re-invokes (bounded), then the dialog drive runs as ONE long evaluation.
 * Any other honest failure (offline / unauthorized / refused / staged errors)
 * passes straight through — never retried into a fake success.
 */

import {
  BrokerError,
  UPLOAD_NAVIGATE_RETRY_MS,
  brokerUploadExecute,
  type BrokerUploadExecuteInput,
  type BrokerUploadExecuteSuccess,
} from "@/lib/broker";

/** Total drive attempts: the initial invoke + 2 navigating re-invokes. */
export const UPLOAD_NAVIGATE_ATTEMPTS = 3;

/** The honest 'navigating' intermediate: the broker's 502 body (carried on
 *  the BrokerError's detail) nests detail.stage === 'navigating' and the
 *  message says to re-invoke. */
export function isNavigateIntermediate(err: BrokerError): boolean {
  const body = err.detail as { detail?: { stage?: string } } | null | undefined;
  return (
    body?.detail?.stage === "navigating" || /re-invoke to drive the dialog/.test(err.message ?? "")
  );
}

/** Drive the staged upload through the broker (the honest ladder). */
export async function driveUploadExecute(
  input: BrokerUploadExecuteInput
): Promise<BrokerUploadExecuteSuccess | BrokerError> {
  for (let attempt = 1; ; attempt++) {
    const result = await brokerUploadExecute(input);
    if (!(result instanceof BrokerError)) return result;
    if (
      result.kind === "action-failed" &&
      isNavigateIntermediate(result) &&
      attempt < UPLOAD_NAVIGATE_ATTEMPTS
    ) {
      await new Promise((r) => setTimeout(r, UPLOAD_NAVIGATE_RETRY_MS));
      continue;
    }
    return result;
  }
}

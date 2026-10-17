/**
 * P23-B (G3/G4) — the env-keyed server LLM seam (z-ai-web-dev-sdk).
 *
 * The lane laws this module carries:
 *  - SERVER-ONLY by construction: the SDK is imported lazily inside the call
 *    path (no static import anywhere reachable from a client component), and
 *    only route handlers / server services call `llmChat`. A client bundle
 *    that (mistakenly) imported this module would find `llmConfigured()`
 *    false — `process.env.ZAI_API_KEY` does not exist in the browser — so
 *    every AI surface degrades honestly instead of leaking a key.
 *  - ENV-KEYED ACTIVATION: `ZAI_API_KEY` (required) + optional
 *    `ZAI_BASE_URL` (default: the Z.ai platform endpoint) and `ZAI_TOKEN`.
 *    No key → callers must answer 200 {status:"disabled"} BEFORE any LLM
 *    call (`llmConfigured()` gate); the SDK is never even constructed.
 *  - HONEST FAILURES: an LLM request failure or an empty answer throws
 *    `LlmError` (status 502) — routes surface it verbatim with a client-side
 *    retry; never a fabricated answer.
 *  - The z-ai-web-dev-sdk's own `ZAI.create()` reads `.z-ai-config` FILES
 *    (cwd → home → /etc) and takes no arguments; the env bridge constructs
 *    the client directly through the class's public constructor so the env
 *    vars are the single source of truth (a machine-local config file can
 *    never silently activate the seam).
 */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The SDK's chat-completions surface (structural — no SDK types leak out). */
interface LlmClient {
  chat: { completions: { create: (body: unknown) => Promise<unknown> } };
}

/** The documented default (the Z.ai platform endpoint; overridable via env). */
export const ZAI_DEFAULT_BASE_URL = "https://internal-api.z.ai/v1";

/** An honest LLM failure — routes map this to 502 with the message verbatim. */
export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

/** True when the seam is activated (ZAI_API_KEY set + non-blank). */
export function llmConfigured(): boolean {
  return (process.env.ZAI_API_KEY ?? "").trim().length > 0;
}

let client: LlmClient | null = null;

/** Env → SDK config (the env-keyed bridge; constructed at most once). */
async function getClient(): Promise<LlmClient> {
  if (client) return client;
  const apiKey = (process.env.ZAI_API_KEY ?? "").trim();
  const baseUrl = (process.env.ZAI_BASE_URL ?? "").trim() || ZAI_DEFAULT_BASE_URL;
  const token = (process.env.ZAI_TOKEN ?? "").trim() || undefined;
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const Ctor = ZAI as unknown as new (config: unknown) => LlmClient;
  client = new Ctor({ baseUrl, apiKey, token });
  return client;
}

/** Test seam (the setUpstream/setUpstashRest pattern): inject a fake chat. */
export type LlmChatFn = (messages: LlmMessage[]) => Promise<string>;
let injectedLlm: LlmChatFn | null = null;

export function setLlmForTests(impl: LlmChatFn | null): void {
  injectedLlm = impl;
}

/** Test hook: drop the injected fake AND the constructed client. */
export function resetLlmForTests(): void {
  injectedLlm = null;
  client = null;
}

function contentOf(completion: unknown): string | null {
  const c = (completion as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]
    ?.message?.content;
  return typeof c === "string" && c.trim() ? c : null;
}

/**
 * One chat completion → the assistant's text content. Throws LlmError on
 * request failure or an empty/absent answer — never returns fabricated text.
 * The injected test seam rides the SAME honest path (its failures wrap and
 * its empties refuse, exactly like the real client).
 */
export async function llmChat(messages: LlmMessage[]): Promise<string> {
  let content: string | null = null;
  try {
    if (injectedLlm) {
      content = await injectedLlm(messages);
    } else {
      // belt-and-braces: callers gate on llmConfigured() first; a seam call
      // without the key is a programming error, not a silent disabled state.
      if (!llmConfigured()) {
        throw new LlmError("AI answers are not configured on this deployment");
      }
      const completion = await (await getClient()).chat.completions.create({
        messages,
        thinking: { type: "disabled" },
      });
      content = contentOf(completion);
    }
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(
      e instanceof Error ? `The AI request failed — ${e.message}` : "The AI request failed"
    );
  }
  if (content === null || !content.trim()) {
    throw new LlmError("The AI returned an empty answer");
  }
  return content;
}

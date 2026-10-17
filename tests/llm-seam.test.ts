/**
 * P23-B — the env-keyed LLM seam: activation, the honest failure family, the
 * injectable test seam. No network — the SDK client is never constructed in
 * these tests (no env + injection covers every path the routes take).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  llmChat,
  llmConfigured,
  LlmError,
  resetLlmForTests,
  setLlmForTests,
  ZAI_DEFAULT_BASE_URL,
  type LlmMessage,
} from "@/lib/ai/llm";

const ENV_KEY = "ZAI_API_KEY";

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  resetLlmForTests();
});
afterEach(() => {
  if (savedKey === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedKey;
  resetLlmForTests();
});

describe("llmConfigured — the env-keyed activation", () => {
  test("unset / blank key → not configured", () => {
    delete process.env[ENV_KEY];
    expect(llmConfigured()).toBe(false);
    process.env[ENV_KEY] = "   ";
    expect(llmConfigured()).toBe(false);
  });

  test("a real key → configured", () => {
    process.env[ENV_KEY] = "zai-test-key";
    expect(llmConfigured()).toBe(true);
  });

  test("the documented default endpoint is exported (the optional-override story)", () => {
    expect(ZAI_DEFAULT_BASE_URL).toBe("https://internal-api.z.ai/v1");
  });
});

describe("llmChat — the honest failure family", () => {
  test("without the key (and no injection) → LlmError, never a fabricated answer", async () => {
    expect(llmConfigured()).toBe(false);
    try {
      await llmChat([{ role: "user", content: "hi" }]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).status).toBe(502);
      expect((e as LlmError).message).toContain("not configured");
    }
  });

  test("an injected LLM serves the content verbatim (the fixtures seam)", async () => {
    setLlmForTests(async (messages) => {
      expect(messages.length).toBeGreaterThan(0);
      return "the answer";
    });
    const out = await llmChat([{ role: "user", content: "q" }]);
    expect(out).toBe("the answer");
  });

  test("an LLM request failure → LlmError carrying the cause, status 502", async () => {
    setLlmForTests(async () => {
      throw new Error("boom");
    });
    try {
      await llmChat([{ role: "user", content: "q" }]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).status).toBe(502);
      expect((e as LlmError).message).toContain("boom");
    }
  });

  test("an empty answer → LlmError (never an empty fabricated surface)", async () => {
    setLlmForTests(async () => "   ");
    try {
      await llmChat([{ role: "user", content: "q" }]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).message).toContain("empty answer");
    }
  });

  test("clearing the injection restores the real path (env-clean → not configured)", async () => {
    setLlmForTests(async () => "x");
    setLlmForTests(null);
    await expect(llmChat([{ role: "user", content: "q" }])).rejects.toBeInstanceOf(LlmError);
  });
});

describe("the message contract", () => {
  test("the injected seam receives the messages the routes build", async () => {
    const seen: LlmMessage[][] = [];
    setLlmForTests(async (messages) => {
      seen.push(messages);
      return "ok";
    });
    await llmChat([
      { role: "system", content: "sys" },
      { role: "user", content: "the question" },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "the question" },
    ]);
  });
});

describe("the server-only law (the seam never rides a client component)", () => {
  /** every source file under the client-reachable trees */
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(p);
    }
    return out;
  }

  test("src/components and src/hooks never import the LLM seam or the SDK", () => {
    const offenders: string[] = [];
    for (const file of [...walk("src/components"), ...walk("src/hooks")]) {
      const text = readFileSync(file, "utf8");
      if (text.includes("@/lib/ai/llm") || text.includes("z-ai-web-dev-sdk")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the only SDK importer in src/ is the seam itself (lazy, inside the call path)", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file === join("src", "lib", "ai", "llm.ts")) continue;
      if (readFileSync(file, "utf8").includes("z-ai-web-dev-sdk")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

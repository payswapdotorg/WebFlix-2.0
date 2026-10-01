/**
 * WFX2-P3-LC tests — the live-chat-send executor script:
 *
 *  - the navigation contract: requiredUrl routes live-chat-send to the live
 *    watch page (the executor navigates the logged-in tab there before the
 *    script runs);
 *  - the script SHAPE: the real-composer selector
 *    (yt-live-chat-text-input-field-renderer #input), the Enter dispatch,
 *    the send-button fallback, the stream verification scan, the honest
 *    error branches, the kinds-module wrapper (awaitable IIFE + the
 *    __exception guard), parseability;
 *  - the script BEHAVIOR against a hand-rolled fake DOM (no browser, no
 *    library — pure objects routing the script's own selector strings):
 *    the happy path (type → Enter → verified, messageId + author read from
 *    the stream row), the send-button fallback click, the collapsed-chat
 *    expansion, and every honest-error branch: members-only, chat disabled,
 *    composer absent, send button absent, typing failed, slow mode
 *    (pre-check and post-Enter), send failed, and the unverified-but-sent
 *    state (composer cleared, render lag).
 */
import { describe, expect, test } from "bun:test";
import { liveChatSendScript } from "./livechat";
import { requiredUrl } from "../executor";

/* ------------------------------------------------------------------ */
/* the navigation contract                                             */
/* ------------------------------------------------------------------ */

describe("live-chat-send — navigation (the registry's requiredUrl)", () => {
  test("routes the tab to the live watch page for the videoId", () => {
    expect(
      requiredUrl({ kind: "live-chat-send", target: { videoId: "dQw4w9WgXcQ" }, payload: { message: "hi" } })
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  test("no videoId → null (the executor refuses to guess a surface)", () => {
    expect(requiredUrl({ kind: "live-chat-send", target: {}, payload: { message: "hi" } })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* the script shape                                                    */
/* ------------------------------------------------------------------ */

describe("live-chat-send — the script shape", () => {
  const built = liveChatSendScript("hello from WebFlix");

  test("kind-module contract: {script, timeoutMs} with a generous window", () => {
    expect(typeof built.script).toBe("string");
    expect(built.timeoutMs).toBeGreaterThanOrEqual(30_000);
  });

  test("the real live-chat composer selector + the #input editable", () => {
    expect(built.script).toContain("yt-live-chat-text-input-field-renderer");
    expect(built.script).toContain("#input");
  });

  test("types via the established focus → selectAll → insertText pattern", () => {
    expect(built.script).toContain("input.focus()");
    expect(built.script).toContain("document.execCommand('selectAll',false,null)");
    expect(built.script).toContain("document.execCommand('insertText',false,");
    expect(built.script).toContain('"hello from WebFlix"');
  });

  test("presses Enter on the composer + the send-button fallback", () => {
    expect(built.script).toContain("new KeyboardEvent('keydown'");
    expect(built.script).toContain("key:'Enter'");
    expect(built.script).toContain("sendBtn.click()");
  });

  test("verifies against the chat stream (the latest N authored rows)", () => {
    expect(built.script).toContain("yt-live-chat-text-message-renderer");
    expect(built.script).toContain('querySelector("#message")');
    expect(built.script).toContain("slice(-40)");
  });

  test("the honest-error branches are present", () => {
    for (const branch of [
      "chat-members-only",
      "chat-slow-mode",
      "chat-disabled",
      "live-chat-composer-not-found",
      "live-chat-send-button-not-found",
      "live-chat-typing-failed",
      "live-chat-send-failed",
    ]) {
      expect(built.script).toContain(`'${branch}'`);
    }
    // youtube.com's own state copy drives the detection regexes
    expect(built.script).toContain("chat is available to members only");
    expect(built.script).toContain("chat is disabled");
    expect(built.script).toContain("slow mode");
  });

  test("the kinds-module wrapper: awaitable IIFE with the __exception guard", () => {
    expect(built.script.startsWith("(async()=>{")).toBe(true);
    expect(built.script).toContain("__exception");
    expect(built.script.endsWith("})()")).toBe(true);
  });

  test("the script parses as JavaScript", () => {
    expect(() => new Function(`return (${built.script});`)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* the fake DOM (the script's own selector strings, routed)             */
/* ------------------------------------------------------------------ */

interface FakeEvent {
  type: string;
  key: string;
}

interface FakeEl {
  id: string;
  textContent: string;
  attrs: Record<string, string>;
  clicks: number;
  onClick?: () => void;
  onEvent?: (evt: FakeEvent) => void;
  routes: Record<string, FakeEl[]>;
  focus(): void;
  click(): void;
  dispatchEvent(evt: FakeEvent): boolean;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
}

function makeEl(text = "", opts: Partial<FakeEl> = {}): FakeEl {
  const el: FakeEl = {
    id: opts.id ?? "",
    textContent: text,
    attrs: opts.attrs ?? {},
    clicks: 0,
    onClick: opts.onClick,
    onEvent: opts.onEvent,
    routes: opts.routes ?? {},
    focus() {
      currentDoc!.focused = el;
    },
    click() {
      el.clicks += 1;
      el.onClick?.();
    },
    dispatchEvent(evt: FakeEvent) {
      el.onEvent?.(evt);
      return true;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name);
    },
    querySelector(sel) {
      return el.routes[sel]?.[0] ?? null;
    },
    querySelectorAll(sel) {
      return el.routes[sel] ?? [];
    },
  };
  return el;
}

interface FakeDoc {
  title: string;
  focused: FakeEl | null;
  routes: Record<string, FakeEl[]>;
  execCalls: { cmd: string; value?: string }[];
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  execCommand(cmd: string, _ui: boolean | null, value?: string): boolean;
}

let currentDoc: FakeDoc | null = null;

interface Scenario {
  message?: string;
  composer?: boolean;
  expandable?: boolean;
  notice?: string;
  tip?: string;
  sendDisabled?: boolean;
  typingFails?: boolean;
  enterSends?: boolean;
  clickSends?: boolean;
  echoInStream?: boolean;
  /** after the send lands, bury it under 45 newer rows (the -40 window test) */
  buryAfterSend?: boolean;
  /** a platform notice that appears only AFTER the failed Enter (the
   * post-send classification branch — the pre-checks saw nothing) */
  noticeAfterEnter?: string;
  preStream?: string[];
  messageId?: string;
}

const INPUT_SEL =
  "yt-live-chat-text-input-field-renderer #input, yt-live-chat-text-input-field-renderer div#input[contenteditable]";
const SEND_SEL =
  "#send-button button, yt-live-chat-send-button-renderer button, ytd-live-chat-input-panel-renderer #send-button button";
const TOGGLE_SEL =
  "ytd-live-chat-frame-renderer #show-hide-button button, yt-live-chat-renderer #show-hide-button button, #show-hide-button button";
const NOTICE_SEL =
  "yt-live-chat-renderer yt-alert-renderer, ytd-live-chat-frame-renderer yt-alert-renderer, yt-live-chat-message-renderer";
const TIP_SEL =
  "yt-live-chat-text-input-field-renderer tp-yt-paper-tooltip, #send-button tp-yt-paper-tooltip, yt-live-chat-text-input-field-renderer #label";
const STREAM_SEL = "yt-live-chat-text-message-renderer";

/** Build the fake watch page for a scenario. */
function makeScenario(s: Scenario = {}): { doc: FakeDoc; input: FakeEl; sendBtn: FakeEl; stream: FakeEl[] } {
  const message = s.message ?? "hello from the fake tab";
  const stream: FakeEl[] = (s.preStream ?? []).map((body, i) => streamRow(body, `yt-pre-${i}`));
  const doc = {
    title: "the live stream - YouTube",
    focused: null as FakeEl | null,
    routes: {} as Record<string, FakeEl[]>,
    execCalls: [] as { cmd: string; value?: string }[],
    querySelector(sel: string) {
      return doc.routes[sel]?.[0] ?? null;
    },
    querySelectorAll(sel: string) {
      return doc.routes[sel] ?? [];
    },
    execCommand(cmd: string, _ui: boolean | null, value?: string) {
      doc.execCalls.push({ cmd, value });
      if (cmd === "insertText" && doc.focused && !s.typingFails) {
        doc.focused.textContent = value ?? "";
      }
      return true;
    },
  } as FakeDoc;

  const input = makeEl("");
  const sendBtn = makeEl("Send", {
    attrs: s.sendDisabled ? { disabled: "" } : {},
  });
  const doSend = () => {
    input.textContent = "";
    if (s.echoInStream !== false) {
      stream.push(streamRow(message, s.messageId ?? "yt-row-new"));
      if (s.buryAfterSend) {
        for (let i = 0; i < 45; i++) stream.push(streamRow(`newer noise ${i}`, `yt-noise-${i}`));
      }
    }
  };
  input.onEvent = (evt) => {
    if (evt.type === "keydown" && evt.key === "Enter") {
      if (s.enterSends !== false) doSend();
      if (s.noticeAfterEnter) doc.routes[NOTICE_SEL] = [makeEl(s.noticeAfterEnter)];
    }
  };
  sendBtn.onClick = () => {
    if (s.clickSends !== false) doSend();
  };

  // the composer (hidden until the collapsed chat expands when expandable)
  if (s.composer !== false) doc.routes[INPUT_SEL] = [input];
  doc.routes[SEND_SEL] = [sendBtn];
  doc.routes["yt-live-chat-renderer"] = [makeEl("Live chat")];
  doc.routes[NOTICE_SEL] = s.notice ? [makeEl(s.notice)] : [];
  doc.routes[TIP_SEL] = s.tip ? [makeEl(s.tip)] : [];
  doc.routes[STREAM_SEL] = stream;
  if (s.expandable) {
    const toggle = makeEl("Show chat", {
      onClick: () => {
        doc.routes[INPUT_SEL] = [input];
      },
    });
    doc.routes[TOGGLE_SEL] = [toggle];
  }
  currentDoc = doc;
  return { doc, input, sendBtn, stream };
}

/** A stream row: the authored message + author-name sub-elements. */
function streamRow(body: string, id: string): FakeEl {
  return makeEl(body, {
    id,
    routes: {
      "#message": [makeEl(body)],
      "#author-name": [makeEl("Operator")],
    },
  });
}

class FakeKeyboardEvent {
  type: string;
  key: string;
  constructor(type: string, init?: { key?: string }) {
    this.type = type;
    this.key = init?.key ?? "";
  }
}

/** Run a script string against the fake page (instant timers + a clock that
 * advances 5s per Date.now() call so until() exhausts its windows fast). */
async function runPageScript(scriptStr: string, doc: FakeDoc): Promise<Record<string, unknown>> {
  let clock = 0;
  const FakeDate = class {
    static now() {
      clock += 5000;
      return clock;
    }
  };
  const instantTimeout = (fn: () => void) => {
    fn();
    return 0;
  };
  const location = { href: "https://www.youtube.com/watch?v=LIVE1234567" };
  const fn = new Function(
    "window",
    "document",
    "location",
    "KeyboardEvent",
    "Date",
    "setTimeout",
    `"use strict"; return (${scriptStr});`
  );
  return (await fn({}, doc, location, FakeKeyboardEvent, FakeDate, instantTimeout)) as Record<
    string,
    unknown
  >;
}

/* ------------------------------------------------------------------ */
/* the script behavior (the fake DOM)                                  */
/* ------------------------------------------------------------------ */

describe("live-chat-send — behavior against the fake DOM", () => {
  test("happy path: type → Enter → the message appears in the stream → verified + messageId + author", async () => {
    const page = makeScenario({ message: "hello from the fake tab" });
    const out = await runPageScript(liveChatSendScript("hello from the fake tab").script, page.doc);
    expect(out.ok).toBe(true);
    expect(out.verified).toBe(true);
    expect(out.path).toBe("ui");
    expect(out.error).toBeUndefined();
    expect(out.detail).toEqual({ messageId: "yt-row-new", author: "Operator" });
    // the real composer was driven: focus + insertText + Enter keydown/keyup
    expect(page.doc.execCalls).toEqual([
      { cmd: "selectAll", value: null },
      { cmd: "insertText", value: "hello from the fake tab" },
    ]);
    expect(page.input.textContent).toBe(""); // the composer cleared
  });

  test("Enter fails → the send-button click lands the send (belt-and-braces)", async () => {
    const page = makeScenario({ message: "via the button", enterSends: false, clickSends: true });
    const out = await runPageScript(liveChatSendScript("via the button").script, page.doc);
    expect(out.ok).toBe(true);
    expect(out.verified).toBe(true);
    expect(page.sendBtn.clicks).toBe(1); // the fallback actually clicked
    expect((out.detail as Record<string, unknown>).messageId).toBe("yt-row-new");
  });

  test("collapsed chat: the expand toggle is clicked, then the composer appears and the send proceeds", async () => {
    const page = makeScenario({ message: "expand then send", composer: false, expandable: true });
    const out = await runPageScript(liveChatSendScript("expand then send").script, page.doc);
    expect(out.ok).toBe(true);
    expect(out.verified).toBe(true);
  });

  test("members-only chat: the notice replaces the usable composer → honest chat-members-only", async () => {
    const page = makeScenario({ composer: false, notice: "Chat is available to members only" });
    const out = await runPageScript(liveChatSendScript("members only?").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("chat-members-only");
    expect(out.path).toBe("ui");
    const dom = out.dom as Record<string, unknown>;
    expect(String(dom.notice)).toContain("members only");
  });

  test("chat disabled: 'Chat is disabled for this live stream.' → honest chat-disabled", async () => {
    const page = makeScenario({ composer: false, notice: "Chat is disabled for this live stream." });
    const out = await runPageScript(liveChatSendScript("anyone?").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("chat-disabled");
  });

  test("composer absent, no platform state → honest live-chat-composer-not-found (not a live stream)", async () => {
    const page = makeScenario({ composer: false });
    const out = await runPageScript(liveChatSendScript("where is chat").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("live-chat-composer-not-found");
    const dom = out.dom as Record<string, unknown>;
    expect(dom.note).toContain("no live-chat composer");
  });

  test("send button missing → honest live-chat-send-button-not-found (no typing attempted)", async () => {
    const page = makeScenario({});
    delete page.doc.routes[SEND_SEL];
    const out = await runPageScript(liveChatSendScript("no button").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("live-chat-send-button-not-found");
    expect(page.doc.execCalls).toHaveLength(0); // never typed
  });

  test("typing failed (the composer did not accept the text) → honest live-chat-typing-failed", async () => {
    const page = makeScenario({ typingFails: true });
    const out = await runPageScript(liveChatSendScript("will not type").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("live-chat-typing-failed");
  });

  test("slow mode pre-check: the send control is held off with the countdown notice → honest chat-slow-mode before typing", async () => {
    const page = makeScenario({
      sendDisabled: true,
      tip: "You can send messages again in 5 seconds",
    });
    const out = await runPageScript(liveChatSendScript("too soon").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("chat-slow-mode");
    expect(page.doc.execCalls).toHaveLength(0); // never typed — the state was honest UP FRONT
  });

  test("slow mode post-Enter: the countdown notice appears only after the failed send → honest chat-slow-mode", async () => {
    const page = makeScenario({
      enterSends: false,
      clickSends: false,
      noticeAfterEnter: "You can send messages again in 6 seconds",
    });
    const out = await runPageScript(liveChatSendScript("still too soon").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("chat-slow-mode");
    const dom = out.dom as Record<string, unknown>;
    expect(String(dom.notice)).toContain("again in 6 seconds");
  });

  test("members-only surfacing post-Enter: the notice appears after the failed send → honest chat-members-only", async () => {
    const page = makeScenario({
      enterSends: false,
      clickSends: false,
      noticeAfterEnter: "Chat is available to members only",
    });
    const out = await runPageScript(liveChatSendScript("members gate").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("chat-members-only");
  });

  test("send did not fire, no platform state explains it → honest live-chat-send-failed with the DOM", async () => {
    const page = makeScenario({ enterSends: false, clickSends: false });
    const out = await runPageScript(liveChatSendScript("stuck text").script, page.doc);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("live-chat-send-failed");
    const dom = out.dom as Record<string, unknown>;
    expect(dom.inputText).toBe("stuck text"); // the composer still holds it
    expect(dom.sendDisabled).toBe(false);
  });

  test("composer cleared but the stream lags → ok:true, verified:false with the honest note", async () => {
    const page = makeScenario({ echoInStream: false });
    const out = await runPageScript(liveChatSendScript("render lag").script, page.doc);
    expect(out.ok).toBe(true);
    expect(out.verified).toBe(false);
    const detail = out.detail as Record<string, unknown>;
    expect(String(detail.note)).toContain("not yet visible");
  });

  test("verification scans only the latest 40 rows (a needle buried under 40+ newer rows is NOT claimed as verified)", async () => {
    // the send lands, then 45 newer rows bury it outside the -40 window →
    // the honest answer is ok:true / verified:false (the composer cleared;
    // the row could not be re-read) — never a false "verified"
    const page = makeScenario({ message: "buried message", buryAfterSend: true });
    const out = await runPageScript(liveChatSendScript("buried message").script, page.doc);
    expect(out.ok).toBe(true);
    expect(out.verified).toBe(false);
    expect((out.detail as Record<string, unknown>).note).toContain("not yet visible");
  });
});

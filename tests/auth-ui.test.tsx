/// <reference types="bun-types" />
/**
 * WFX2-P2-AU tests — the auth UI surfaces (happy-dom + createRoot/act, the
 * comment-composer test pattern): the youtube.com signed-out screen copy,
 * the personal-surface gate states, the guest "Sign in to comment" composer
 * box, the header's guest pill / signed-in account dropdown, the sign-in
 * form's error + honest-recovery copy, the sign-up form's validation +
 * duplicate-email state, and the account page's identity edit.
 *
 * The session hook + next/navigation are mocked via mock.module (the
 * action-routes pattern — file-scoped by --isolate, restored in afterAll).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "NodeFilter",
  "NodeListOf",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
  "React",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- the mutable session state the mocked hook serves ----
type SessionState = { status: "loading" | "authenticated" | "unauthenticated"; user?: Record<string, unknown> | null };
let sessionState: SessionState = { status: "unauthenticated", user: null };

const realSessionHook = { ...(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/hooks/use-webflix-session");
})() } as Record<string, unknown>;
mock.module("@/hooks/use-webflix-session", () => ({
  useWebFlixSession: () => ({
    status: sessionState.status,
    user: sessionState.user ?? null,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realNavigation = { ...require("next/navigation") } as Record<string, unknown>;
mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

// ---- the fetch stub (per-test programmable) ----
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let fetchHandler: FetchHandler = () => new Response("{}", { status: 200 });
const fetchLog: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
  fetchLog.push({ url: u, method, body });
  return fetchHandler(u, init);
}) as unknown as typeof fetch;

const { SignedOutScreen } = await import("@/components/auth/signed-out-screen");
const { PersonalSurfaceGate } = await import("@/components/auth/personal-surface-gate");
const { CommentComposer } = await import("@/components/watch/comment-composer");
const { AccountMenu } = await import("@/components/app/account-menu");
const { SignInForm } = await import("@/components/auth/signin-form");
const { SignUpForm } = await import("@/components/auth/signup-form");
const AccountPage = (await import("@/app/account/page")).default;

const VIEWER = { id: "u1", handle: "demo", name: "Demo", avatarUrl: "https://x/a.png" };

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const docAll = (sel: string): HTMLElement[] =>
  Array.from(win.document.querySelectorAll(sel) as unknown as HTMLElement[]);

async function render(el: React.ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(el);
  });
}

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    input.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, text);
  await act(async () => {
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

const buttonByText = (re: RegExp, scope: HTMLElement[] = []): HTMLButtonElement | null => {
  const pool = scope.length ? scope : all("button");
  return (pool.find((b) => re.test((b.textContent ?? "").trim())) as HTMLButtonElement | undefined) ?? null;
};

beforeEach(() => {
  toasts.length = 0;
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  sessionState = { status: "unauthenticated", user: null };
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

afterAll(() => {
  mock.module("@/hooks/use-webflix-session", () => realSessionHook);
  mock.module("next/navigation", () => realNavigation);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("SignedOutScreen — the youtube.com/history signed-out layout", () => {
  test("illustration + heading + message + the red Sign in button with the redirect", async () => {
    await render(
      <SignedOutScreen message="Sign in to see your history on WebFlix" redirect="/history" />
    );
    expect(host!.textContent).toContain("Don't miss new videos");
    expect(host!.textContent).toContain("Sign in to see your history on WebFlix");
    const link = all("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/signin?redirect=%2Fhistory");
  });
});

describe("PersonalSurfaceGate — guests see the screen, signed-in sees the surface", () => {
  test("unauthenticated → the signed-out screen, children never render (no data fetch)", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(
      <PersonalSurfaceGate surface="liked">
        <p data-testid="the-surface">Your liked videos</p>
      </PersonalSurfaceGate>
    );
    expect(host!.textContent).toContain("Sign in to see your liked videos on WebFlix");
    expect(q("[data-testid='the-surface']")).toBeNull();
    expect(fetchLog).toHaveLength(0);
  });

  test("authenticated → the surface itself renders", async () => {
    sessionState = {
      status: "authenticated",
      user: { id: "u1", email: "op@webflix.test", displayName: "Operator", avatarSeed: 12 },
    };
    await render(
      <PersonalSurfaceGate surface="liked">
        <p data-testid="the-surface">Your liked videos</p>
      </PersonalSurfaceGate>
    );
    expect(q("[data-testid='the-surface']")).not.toBeNull();
    expect(host!.textContent).not.toContain("Sign in to see");
  });
});

describe("CommentComposer — the guest 'Sign in to comment' box (youtube.com watch parity)", () => {
  test("renders the box with the red Sign in affordance; no textarea, never a write", async () => {
    await render(
      <CommentComposer videoId="dQw4w9WgXcQ" viewer={VIEWER} guest onSubmitted={() => {}} />
    );
    expect(q("textarea")).toBeNull(); // never an editable composer for guests
    expect(host!.textContent).toContain("Sign in to comment");
    const link = all("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/signin?redirect=%2Fwatch%2FdQw4w9WgXcQ");
    expect(fetchLog).toHaveLength(0); // never a fake write
  });
});

describe("AccountMenu — the header states", () => {
  test("guest → the outlined Sign in pill linking /signin", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<AccountMenu />);
    const link = all("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/signin");
    expect(link!.textContent).toContain("Sign in");
  });

  test("signed-in → the initial-based avatar + the account dropdown contents", async () => {
    sessionState = {
      status: "authenticated",
      user: { id: "u1", email: "operator@webflix.test", displayName: "The Operator", avatarSeed: 200 },
    };
    await render(<AccountMenu />);
    const trigger = win.document.querySelector("[data-testid='account-avatar-button']") as unknown as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect((trigger.textContent ?? "").trim()).toBe("T"); // initial-based avatar
    // open the dropdown (radix trigger: pointerdown, button 0)
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    await act(async () => {});
    const body = win.document.body.textContent ?? "";
    expect(body).toContain("The Operator");
    expect(body).toContain("operator@webflix.test");
    // P14-YOU: the LIVE 2026 menu labels ("Google Account" for the app's
    // account page, "YouTube Studio", Sign out beside the header group)
    expect(body).toContain("Google Account");
    expect(body).toContain("YouTube Studio");
    expect(body).toContain("Sign out");
    expect(body).toContain("Purchases & memberships");
    expect(body).toContain("Your data in YouTube");
    expect(body).toContain("Keyboard shortcuts");
    expect(body).toContain("Help");
    expect(body).toContain("Send feedback");
    // the retired pre-parity labels are gone
    expect(body).not.toContain("Your account");
    expect(body).not.toContain("WebFlix Studio");
    // the menu links point at the real surfaces
    const accountLink = docAll("a").find((a) => a.getAttribute("href") === "/account");
    const studioLink = docAll("a").find((a) => a.getAttribute("href") === "/studio");
    expect(accountLink).toBeDefined();
    expect(studioLink).toBeDefined();
  });
});

describe("SignInForm — Google-parity card + honest copy", () => {
  function fields() {
    return {
      email: q("#email") as unknown as HTMLInputElement,
      password: q("#password") as unknown as HTMLInputElement,
    };
  }

  test("renders the card (heading, subheading, fields, show toggle, create-account link)", async () => {
    await render(<SignInForm redirectTo={null} />);
    expect(host!.textContent).toContain("Sign in");
    expect(host!.textContent).toContain("to continue to WebFlix");
    expect(q("#email")).not.toBeNull();
    expect(q("#password")).not.toBeNull();
    const createLink = all("a").find((a) => (a.textContent ?? "").trim() === "Create account");
    expect(createLink).toBeDefined();
    expect(createLink!.getAttribute("href")).toBe("/signup");
    // the show-password toggle flips the input type
    const show = buttonByText(/^show$/i);
    expect(show).not.toBeNull();
    await act(async () => {
      show!.click();
    });
    expect(fields().password.type).toBe("text");
  });

  test("wrong password → the Google-style error copy; no navigation", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/auth/csrf")) {
        return Response.json({ csrfToken: "tok" });
      }
      if (url.includes("/api/auth/callback/credentials")) {
        return Response.json({ url: "http://localhost:3000/api/auth/error" }, { status: 401 });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<SignInForm redirectTo={null} />);
    await typeInto(fields().email, "op@webflix.test");
    await typeInto(fields().password, "wrong-password-1");
    const next = buttonByText(/^next$/i);
    await act(async () => {
      next!.click();
    });
    await act(async () => {});
    expect(host!.textContent).toContain("Wrong password. Try again or click Forgot password to reset it.");
    expect(fetchLog.some((f) => f.url.includes("/api/auth/callback/credentials"))).toBe(true);
  });

  test("Forgot password? → the honest account-recovery degradation", async () => {
    await render(<SignInForm redirectTo={null} />);
    const forgot = buttonByText(/forgot password\?/i);
    await act(async () => {
      forgot!.click();
    });
    expect(host!.textContent).toContain("Account recovery is not available yet");
    // the forbidden copy never appears
    expect(host!.textContent).not.toContain("ask the operator");
  });
});

describe("SignUpForm — validation + the duplicate-email honest state", () => {
  function fields() {
    return {
      email: q("#email") as unknown as HTMLInputElement,
      password: q("#password") as unknown as HTMLInputElement,
      name: q("#displayName") as unknown as HTMLInputElement,
    };
  }

  test("the password helper appears under 8 chars (Google's 'Use 8 characters or more')", async () => {
    await render(<SignUpForm redirectTo={null} />);
    await typeInto(fields().password, "short");
    expect(host!.textContent).toContain("Use 8 characters or more");
  });

  test("duplicate email → the honest message with the sign-in link", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/auth/register")) {
        return Response.json(
          { error: "That email already has a WebFlix account. Sign in instead?", code: "duplicate-email" },
          { status: 409 }
        );
      }
      return Response.json({}, { status: 200 });
    };
    await render(<SignUpForm redirectTo={null} />);
    await typeInto(fields().name, "New Viewer");
    await typeInto(fields().email, "dup@webflix.test");
    await typeInto(fields().password, "password123");
    const create = buttonByText(/create account$/i);
    await act(async () => {
      create!.click();
    });
    await act(async () => {});
    expect(host!.textContent).toContain("That email already has a WebFlix account");
    const signinLink = all("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(signinLink).toBeDefined();
    expect(signinLink!.getAttribute("href")).toBe("/signin");
  });
});

describe("AccountPage — the identity edit (signed-in)", () => {
  test("the identity card renders and PATCHes the profile on save", async () => {
    sessionState = {
      status: "authenticated",
      user: { id: "u1", email: "operator@webflix.test", displayName: "The Operator", avatarSeed: 12 },
    };
    fetchHandler = (url, init) => {
      if (url.includes("/api/watch/session")) {
        return Response.json({
          viewer: VIEWER,
          operatorSession: true,
        });
      }
      if (url.includes("/api/auth/profile")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        return Response.json({ user: { displayName: body.displayName, avatarSeed: body.avatarSeed } });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<AccountPage />);
    await act(async () => {}); // let useApi settle
    // the honest operator-session section keeps its wording law
    expect(host!.textContent).toContain("YouTube session");
    expect(host!.textContent).toContain("Operator session connected");
    // the identity card
    const nameInput = q("#displayName") as unknown as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe("The Operator");
    // edit the display name → save → PATCH /api/auth/profile
    await typeInto(nameInput, "Renamed Operator");
    const save = buttonByText(/^save$/i);
    expect(save!.disabled).toBe(false);
    await act(async () => {
      save!.click();
    });
    await act(async () => {});
    const patch = fetchLog.find((f) => f.method === "PATCH" && f.url.includes("/api/auth/profile"));
    expect(patch).toBeDefined();
    expect(patch!.body).toMatchObject({ displayName: "Renamed Operator", avatarSeed: 12 });
    expect(toasts.some((t) => t.includes("Profile updated"))).toBe(true);
  });
});

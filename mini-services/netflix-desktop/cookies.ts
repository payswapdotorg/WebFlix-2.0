/**
 * WebFlix Netflix Desktop — Netflix session-cookie harvesting via a private
 * Apify actor (residential egress; Netflix blocks datacenter login).
 *
 * The actor (apify actor id from env APIFY_ACTOR_ID) runs a stealth Puppeteer
 * against netflix.com/login with the operator's credentials and exports the
 * authenticated cookie set through its default dataset. Credentials live in
 * env only and are never persisted in the repo.
 */

export interface NetflixCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface HarvestResult {
  ok: boolean;
  reason?: string;
  cookies?: NetflixCookie[];
}

const APIFY_TOKEN = process.env.APIFY_TOKEN ?? "";
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID ?? "QouQAyfuuPWX2QTPc";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run the harvester actor and pull the cookie set from its dataset. */
export async function harvestNetflixSession(): Promise<HarvestResult> {
  const email = process.env.NETFLIX_EMAIL ?? "";
  const password = process.env.NETFLIX_PASSWORD ?? "";
  if (!APIFY_TOKEN) return { ok: false, reason: "APIFY_TOKEN missing" };
  if (!email || !password) return { ok: false, reason: "NETFLIX_EMAIL/PASSWORD missing" };

  const runRes = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      emails: [email],
      password,
      proxyGroup: process.env.APIFY_PROXY_GROUP ?? "BUYPROXIES94952",
      country: process.env.APIFY_PROXY_COUNTRY ?? "US",
      attemptsPerEmail: 3,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!runRes.ok) return { ok: false, reason: `apify run start failed: ${runRes.status}` };
  const run = (await runRes.json())?.data as { id: string; defaultDatasetId: string };
  if (!run?.id) return { ok: false, reason: "apify run start returned no id" };

  // poll up to ~8 minutes
  const deadline = Date.now() + 8 * 60_000;
  let status = "READY";
  while (Date.now() < deadline) {
    await sleep(15_000);
    try {
      const st = await fetch(
        `https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_TOKEN}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      status = (await st.json())?.data?.status ?? "UNKNOWN";
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
    } catch {
      /* keep polling */
    }
  }
  if (status !== "SUCCEEDED") return { ok: false, reason: `harvest run ${status}` };

  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}&clean=true`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const items = (await itemsRes.json()) as Array<{
    status?: string;
    cookies?: NetflixCookie[];
  }>;
  const hit = items.find((it) => it.status === "logged-in" && (it.cookies?.length ?? 0) > 0);
  if (!hit) return { ok: false, reason: "harvest completed without a logged-in item" };
  return { ok: true, cookies: hit.cookies };
}

/** The cookie names that must exist for a usable Netflix session. */
export function hasAuthCookies(cookies: NetflixCookie[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return names.has("NetflixId") && names.has("SecureNetflixId");
}

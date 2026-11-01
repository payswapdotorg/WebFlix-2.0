/**
 * Parity two-host acceptance helper — mints THREE real NextAuth session
 * cookies (the repo's own mintSessionCookie law) and resolves all three
 * identities' shadow ids. stdout: JSON { hostCookie, viewerCookie,
 * rivalCookie, hostId, viewerId, rivalId }.
 */
import { mintSessionCookie } from "../tests/helpers";
import { ensureShadowUser } from "../src/lib/watch/local-comments";

const identity = (sub: string, name: string) => ({ id: sub, email: `${sub}@webflix.test`, displayName: name, avatarSeed: 5 });

const hostCookie = await mintSessionCookie({ sub: "u_parity_host", name: "Parity Host", email: "parity-host@webflix.test" });
const viewerCookie = await mintSessionCookie({ sub: "u_parity_viewer", name: "Parity Viewer", email: "parity-viewer@webflix.test" });
const rivalCookie = await mintSessionCookie({ sub: "u_parity_rival", name: "Parity Rival", email: "parity-rival@webflix.test" });

const host = await ensureShadowUser(identity("u_parity_host", "Parity Host"));
const viewer = await ensureShadowUser(identity("u_parity_viewer", "Parity Viewer"));
const rival = await ensureShadowUser(identity("u_parity_rival", "Parity Rival"));

console.log(JSON.stringify({
  hostCookie, viewerCookie, rivalCookie,
  hostId: host.id, viewerId: viewer.id, rivalId: rival.id,
}));

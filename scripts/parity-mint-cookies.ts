/**
 * Parity acceptance helper — mints the two real NextAuth session cookies
 * (the repo's own mintSessionCookie law) AND resolves both identities'
 * shadow ids (the LIVE domain's identity plane). stdout: JSON
 * { hostCookie, viewerCookie, hostId, viewerId }.
 */
import { mintSessionCookie } from "../tests/helpers";
import { ensureShadowUser } from "../src/lib/watch/local-comments";

const hostCookie = await mintSessionCookie({
  sub: "u_parity_host",
  name: "Parity Host",
  email: "parity-host@webflix.test",
});
const viewerCookie = await mintSessionCookie({
  sub: "u_parity_viewer",
  name: "Parity Viewer",
  email: "parity-viewer@webflix.test",
});
const host = await ensureShadowUser({
  id: "u_parity_host",
  email: "parity-host@webflix.test",
  displayName: "Parity Host",
  avatarSeed: 3,
});
const viewer = await ensureShadowUser({
  id: "u_parity_viewer",
  email: "parity-viewer@webflix.test",
  displayName: "Parity Viewer",
  avatarSeed: 4,
});
console.log(JSON.stringify({ hostCookie, viewerCookie, hostId: host.id, viewerId: viewer.id }));

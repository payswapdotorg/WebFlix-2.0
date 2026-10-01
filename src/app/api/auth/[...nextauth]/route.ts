import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";

/**
 * WFX2-P2-AU — the WebFlix auth routes (stock NextAuth v4):
 *   GET/POST /api/auth/session|csrf|signin|signout|callback/[provider]…
 *
 * Credentials provider (email + password against the wf:auth:user:<email>
 * store), JWT session strategy, NEXTAUTH_SECRET-signed. Everything —
 * CSRF, session fetch, sign-out — is stock NextAuth behavior.
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

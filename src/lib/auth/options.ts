/**
 * WFX2-P2-AU — the NextAuth options (credentials + JWT).
 *
 * Session strategy: JWT (stateless, cookie-carried — the Upstash user store
 * holds the ACCOUNT, not the session). The token claims are the contract:
 *   sub = user id, name = display name, email, avatarSeed (avatar hue).
 *
 * THE ARCHITECTURE LAW: authorize() verifies a WEBFLIX identity from the
 * user store (wf:auth:user:<email>). It never touches, creates, or
 * fabricates YouTube accounts — the operator session (YT_COOKIES) stays a
 * separate, honest layer.
 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authSecret } from "./secret";
import { verifyUser } from "./users";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "WebFlix",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await verifyUser(credentials.email, credentials.password);
        if (!user) return null; // → 401 CredentialsSignin (the honest failure)
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          avatarSeed: user.avatarSeed,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: authSecret(),
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, user }) {
      // sign-in event: stamp the WebFlix claims onto the token (sub is set
      // from user.id by NextAuth itself)
      if (user) {
        token.email = user.email ?? token.email;
        token.name = user.name ?? token.name;
        token.avatarSeed = user.avatarSeed ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub as string | undefined) ?? session.user.id;
        session.user.email = token.email ?? session.user.email;
        session.user.name = token.name ?? session.user.name;
        session.user.avatarSeed =
          typeof token.avatarSeed === "number" ? token.avatarSeed : 0;
      }
      return session;
    },
  },
};

/**
 * WFX2-P2-AU — NextAuth type augmentation: the WebFlix claims ride the
 * stock session/JWT shapes (id, avatarSeed) so every consumer (hook, gate,
 * Studio cross-app contract) reads one typed surface.
 */
import type { DefaultSession, DefaultUser } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      avatarSeed?: number;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    avatarSeed?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    avatarSeed?: number;
  }
}

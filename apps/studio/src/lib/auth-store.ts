import { kvGetJson, kvSetJson } from "./cache";

// THE P2-AU user-store contract — identical key schema so accounts work on both apps.
export interface WfAuthUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string; // scrypt$saltHex$hashHex
  avatarSeed: string;
  createdAt: string; // ISO
}

export const AUTH_KEY_PREFIX = "wf:auth:user:";
export const authKey = (email: string): string => AUTH_KEY_PREFIX + email.trim().toLowerCase();
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export async function getAuthUser(email: string): Promise<WfAuthUser | null> {
  return kvGetJson<WfAuthUser>(authKey(email));
}

export async function putAuthUser(user: WfAuthUser): Promise<void> {
  await kvSetJson(authKey(user.email), user); // no TTL — durable user record
}

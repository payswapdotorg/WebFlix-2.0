import { SignInForm } from "@/components/auth/signin-form";

export const metadata = { title: "Sign in — WebFlix" };

/**
 * WFX2-P2-AU — /signin: the WebFlix account sign-in page (Google-account
 * visual parity). `?redirect=` carries the surface that prompted sign-in;
 * a same-app relative path only (safeRedirect — never an open redirect).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  return <SignInForm redirectTo={params.redirect ?? null} />;
}

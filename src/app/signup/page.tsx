import { SignUpForm } from "@/components/auth/signup-form";

export const metadata = { title: "Create account — WebFlix" };

/**
 * WFX2-P2-AU — /signup: the WebFlix account creation page (Google
 * create-account parity). Creates a WEBFLIX identity — never a YouTube
 * account (the architecture law).
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  return <SignUpForm redirectTo={params.redirect ?? null} />;
}

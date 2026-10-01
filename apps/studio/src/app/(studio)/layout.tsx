import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { StudioShell } from "@/components/studio-shell";
import { Toaster } from "@/components/toaster";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return (
    <StudioShell session={session} mainAppUrl={env.MAIN_APP_URL}>
      {children}
      <Toaster />
    </StudioShell>
  );
}

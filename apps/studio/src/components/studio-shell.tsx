"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu, MessageSquarePlus, Radio, Video, X } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { apiGet, apiPost } from "@/lib/studio-client";
import { Dropdown } from "@/components/ui/dropdown";
import type { ChannelInfo } from "@/lib/types";

const MainAppUrlCtx = createContext<string>("");
export const useMainAppUrl = (): string => useContext(MainAppUrlCtx);

export function StudioShell({ session, mainAppUrl, children }: {
  session: { email: string; name: string; seed: string };
  mainAppUrl: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    apiGet<{ channel: ChannelInfo | null }>("/api/studio/channel").then((r) => {
      if (r.ok && r.data.channel) setChannel(r.data.channel);
    });
  }, []);

  const title = channel?.title ?? session.name ?? session.email;
  const initial = title.trim().charAt(0).toUpperCase() || "?";

  return (
    <MainAppUrlCtx.Provider value={mainAppUrl}>
      <div className="flex min-h-screen">
        {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
        <aside className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-60 flex-col border-r bg-white md:sticky md:top-0 md:flex md:h-screen`}>
          <div className="flex h-14 shrink-0 items-center gap-2 px-4">
            <span className="text-lg font-bold tracking-tight">WebFlix <span className="font-normal text-muted-foreground">Studio</span></span>
            <button className="ml-auto rounded p-1 hover:bg-muted md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  <Icon className="h-4 w-4 shrink-0" />{item.label}
                </Link>
              );
            })}
          </nav>
          <div className="shrink-0 border-t p-3 text-xs text-muted-foreground">WebFlix Studio — standalone creator surface</div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-white px-3">
            <button className="rounded p-2 hover:bg-muted md:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>

            <Dropdown align="left" renderTrigger={() => (
              <button type="button" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-muted">
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  {channel?.avatarUrl ? <img src={channel.avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
                </span>
                <span className="hidden max-w-40 truncate text-sm font-medium sm:block">{title}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            )}>
              {() => (
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">Operator channel</p>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{channel?.handle ?? session.email}</p>
                </div>
              )}
            </Dropdown>

            <Dropdown renderTrigger={() => (
              <button type="button" className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                <Video className="h-4 w-4" /> Create <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            )}>
              {(close) => (
                <div>
                  <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" href={`${mainAppUrl}/upload`} target="_blank" rel="noreferrer" onClick={close}><Video className="h-4 w-4" /> Upload video</a>
                  <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" href={`${mainAppUrl}/live`} target="_blank" rel="noreferrer" onClick={close}><Radio className="h-4 w-4" /> Go live</a>
                  <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" href={`${mainAppUrl}/community`} target="_blank" rel="noreferrer" onClick={close}><MessageSquarePlus className="h-4 w-4" /> New post</a>
                  <p className="px-3 py-2 text-xs text-muted-foreground">Opens the main app composer (deep link)</p>
                </div>
              )}
            </Dropdown>

            <div className="ml-auto flex items-center gap-1">
              <Dropdown renderTrigger={() => (
                <button type="button" aria-label="Notifications" className="rounded-full p-2 hover:bg-muted"><Bell className="h-5 w-5" /></button>
              )}>
                {() => <div className="px-3 py-3 text-sm text-muted-foreground">You&apos;re all caught up — no new notifications.</div>}
              </Dropdown>
              <Dropdown renderTrigger={() => (
                <button type="button" aria-label="Account" className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{initial}</button>
              )}>
                {(close) => (
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium">{session.name}</p>
                    <p className="text-xs text-muted-foreground">{session.email}</p>
                    <button
                      className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
                      onClick={async () => { close(); await apiPost("/api/auth/sign-out", {}); window.location.href = "/sign-in"; }}
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                )}
              </Dropdown>
            </div>
          </header>
          <main className="min-w-0 flex-1 bg-[#f9f9f9] p-4 md:p-6">{children}</main>
        </div>
      </div>
    </MainAppUrlCtx.Provider>
  );
}

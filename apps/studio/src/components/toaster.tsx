"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ToastItem { id: number; message: string; tone: "info" | "warn" }

export function showToast(message: string, tone: "info" | "warn" = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("wf-studio-toast", { detail: { message, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    function on(e: Event) {
      const d = (e as CustomEvent<{ message: string; tone: "info" | "warn" }>).detail;
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, message: d.message, tone: d.tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
    }
    window.addEventListener("wf-studio-toast", on);
    return () => window.removeEventListener("wf-studio-toast", on);
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[60] w-80 space-y-2">
      {items.map((t) => (
        <div key={t.id} className={cn("rounded-lg border bg-white p-3 text-sm shadow-lg", t.tone === "warn" && "border-amber-300 bg-amber-50")}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

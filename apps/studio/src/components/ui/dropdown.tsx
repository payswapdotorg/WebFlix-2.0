"use client";

import { useEffect, useRef, useState } from "react";

export function Dropdown({ renderTrigger, children, align = "right" }: {
  renderTrigger: () => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{renderTrigger()}</span>
      {open && (
        <div className={`absolute top-full z-50 mt-1 min-w-52 rounded-lg border bg-white p-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

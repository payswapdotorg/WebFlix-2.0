"use client";

/**
 * WFX2-P5-YA — the shift+/ keyboard-shortcuts overlay (youtube.com parity).
 *
 * Mounted once in the app shell (the sanctioned additive seam: one import +
 * one render). Opens globally on "?" / Shift+"/" from any page, and via
 * openKeyboardShortcuts() (the account-menu entry). The radix Dialog handles
 * Esc + click-out; while the overlay is open the player ignores keys (its own
 * [role=dialog] guard in video-player.tsx).
 *
 * HONESTY LAW: PLAYER_SHORTCUTS documents ONLY the shortcuts really wired in
 * src/components/watch/video-player.tsx's keydown handler. tests/you-hub.test.tsx
 * scans the player source and fails on any documented key that is not wired —
 * keep this list trimmed to reality, never padded.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const OPEN_KEYBOARD_SHORTCUTS_EVENT = "webflix:open-keyboard-shortcuts";

export interface PlayerShortcut {
  /** Key labels as shown in the dialog (["k", "Space"] renders two chips). */
  keys: string[];
  description: string;
}

/**
 * The player's REAL keydown wiring (video-player.tsx, the "keyboard
 * shortcuts (global, YouTube-style)" block): k/space play-pause, j/l seek
 * ∓10s, arrows seek ∓5s + volume, m mute, f fullscreen, t theater, c
 * captions, 0–9 percent seek, Home/End, < / > playback speed. The
 * descriptions state the real magnitudes.
 */
export const PLAYER_SHORTCUTS: PlayerShortcut[] = [
  { keys: ["k", "Space"], description: "Play or pause" },
  { keys: ["j"], description: "Seek back 10 seconds" },
  { keys: ["l"], description: "Seek forward 10 seconds" },
  { keys: ["←", "→"], description: "Seek back or forward 5 seconds" },
  { keys: ["↑", "↓"], description: "Volume up or down" },
  { keys: ["m"], description: "Mute or unmute" },
  { keys: ["f"], description: "Toggle full screen" },
  { keys: ["t"], description: "Toggle theater mode" },
  { keys: ["c"], description: "Toggle captions" },
  { keys: ["0–9"], description: "Seek to 0–90% of the video" },
  { keys: ["Home"], description: "Go to the start of the video" },
  { keys: ["End"], description: "Go to the end of the video" },
  { keys: ["<", ">"], description: "Playback speed down or up" },
];

/** This overlay's own keys — always honest to document. */
const GENERAL_SHORTCUTS: PlayerShortcut[] = [
  { keys: ["?"], description: "Open this shortcut list" },
  { keys: ["Esc"], description: "Close this list" },
];

/** The account-menu entry's bridge — opens the globally mounted overlay. */
export function openKeyboardShortcuts() {
  window.dispatchEvent(new CustomEvent(OPEN_KEYBOARD_SHORTCUTS_EVENT));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** The global mount: shift+/ (and ?) from any page + the menu event. */
export function KeyboardShortcutsMount() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const isShiftSlash = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (!isShiftSlash) return;
      // never hijack typing — the same guard the player uses
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    }
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, onOpenRequest);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            The shortcuts WebFlix&apos;s player really wires — live while a player is
            mounted (the persistent player keeps them working everywhere).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <ShortcutGroup title="Playback" shortcuts={PLAYER_SHORTCUTS} />
          <ShortcutGroup title="General" shortcuts={GENERAL_SHORTCUTS} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutGroup({ title, shortcuts }: { title: string; shortcuts: PlayerShortcut[] }) {
  return (
    <section aria-label={`${title} shortcuts`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-2.5">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.description} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-foreground/90">{shortcut.description}</span>
            <span className="flex shrink-0 gap-1.5">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-xs text-foreground"
                >
                  {key}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

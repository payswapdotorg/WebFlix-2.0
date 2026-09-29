"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* Minimal Web Speech API typings (not in TS DOM lib). */
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type VoiceState = "idle" | "listening" | "error" | "unsupported";

/**
 * Voice search — a REAL Web Speech API attempt with graceful fallback:
 * unsupported browsers / denied mic / no speech → typed-search fallback.
 */
export function VoiceSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const submitQuery = useCallback(
    (q: string) => {
      const query = q.trim();
      if (!query) return;
      onOpenChange(false);
      router.push(`/search?q=${encodeURIComponent(query)}`);
    },
    [onOpenChange, router]
  );

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setState("unsupported");
      return;
    }
    try {
      const rec = new Ctor();
      recognitionRef.current = rec;
      rec.lang = "en-US";
      rec.continuous = false;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let text = "";
        let final = false;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (e.results[i].isFinal) final = true;
        }
        setTranscript(text);
        if (final) {
          rec.stop();
          submitQuery(text);
        }
      };
      rec.onerror = (e) => {
        setState("error");
        setError(
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "Microphone access was blocked. You can allow it in your browser settings, or type your search below."
            : e.error === "no-speech"
              ? "Didn't catch that — try again, or type your search below."
              : `Voice search failed (${e.error}). Type your search below.`
        );
      };
      rec.onend = () => {
        setState((s) => (s === "listening" ? "idle" : s));
      };
      setTyped("");
      setTranscript("");
      setError(null);
      setState("listening");
      rec.start();
    } catch {
      setState("unsupported");
    }
  }, [submitQuery]);

  useEffect(() => {
    if (!open) {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    }
  }, [open]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    []
  );

  const showTypedFallback = state === "unsupported" || state === "error";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) startListening();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md gap-6 rounded-2xl p-6" aria-describedby="voice-desc">
        <DialogHeader>
          <DialogTitle>Voice search</DialogTitle>
          <DialogDescription id="voice-desc">
            {state === "unsupported"
              ? "This browser doesn't support the Web Speech API."
              : state === "error"
                ? "Voice recognition hit a snag."
                : "Speak now — your browser's speech recognition is listening."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            aria-label={state === "listening" ? "Listening" : "Start listening"}
            onClick={startListening}
            className="flex size-20 items-center justify-center rounded-full border border-border bg-secondary text-foreground transition-transform hover:scale-105"
          >
            {state === "listening" ? (
              <span className="relative flex items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yt-red/30" />
                <Mic className="size-8 text-yt-red" />
              </span>
            ) : showTypedFallback ? (
              <MicOff className="size-8 text-muted-foreground" />
            ) : (
              <Mic className="size-8" />
            )}
          </button>
          <p
            className="min-h-6 text-center text-sm text-muted-foreground"
            aria-live="polite"
            data-testid="voice-transcript"
          >
            {transcript
              ? `“${transcript}”`
              : state === "listening"
                ? "Listening…"
                : showTypedFallback
                  ? error ?? "Voice search isn't available here."
                  : "Tap the mic and speak"}
          </p>

          <form
            className="flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitQuery(typed || transcript);
            }}
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={showTypedFallback ? "Type your search instead…" : "Or type to search…"}
              aria-label="Search query"
              className="flex-1 rounded-full"
            />
            <Button type="submit" variant="secondary" className="rounded-full">
              Search
            </Button>
          </form>

          {showTypedFallback && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Dismiss
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

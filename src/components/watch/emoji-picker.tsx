"use client";

/**
 * WFX2-W emoji picker — a real insert: the selected emoji is inserted at
 * the textarea's cursor position.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Smile } from "lucide-react";

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
  "🙂", "😉", "😊", "😍", "🥰", "😘", "😜", "🤪",
  "🤗", "🤔", "🤨", "😐", "😑", "🙄", "😏", "😴",
  "😢", "😭", "😤", "😠", "🤯", "😳", "🥵", "🥶",
  "😱", "😨", "🤡", "👻", "💀", "👽", "🤖", "🎃",
  "👋", "👍", "👎", "👏", "🙌", "🤝", "🙏", "💪",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
  "💯", "🔥", "✨", "⭐", "🎉", "🎊", "🎈", "🎁",
];

export function EmojiPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Insert emoji"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Smile className="size-5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2" aria-label="Emoji picker">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insert ${emoji}`}
              onClick={() => onPick(emoji)}
              className="flex size-7 items-center justify-center rounded text-lg leading-none transition hover:bg-accent"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20", className)} {...props} />;
}

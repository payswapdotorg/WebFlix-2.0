import { CircleDollarSign } from "lucide-react";
import { DegradedSurface } from "@/components/degraded";

export default function EarnPage() {
  return (
    <DegradedSurface
      icon={CircleDollarSign}
      title="Earn"
      lines={[
        "Join the YouTube Partner Program — parity copy, same as studio.youtube.com for non-partner channels.",
        "Revenue analytics require partner features WebFlix Studio doesn't have.",
        "No revenue numbers are shown because none exist — we never fake analytics.",
      ]}
    />
  );
}

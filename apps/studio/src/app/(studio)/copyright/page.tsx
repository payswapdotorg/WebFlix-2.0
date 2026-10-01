import { Copyright } from "lucide-react";
import { DegradedSurface } from "@/components/degraded";

export default function CopyrightPage() {
  return (
    <DegradedSurface
      icon={Copyright}
      title="Copyright"
      lines={[
        "No active copyright claims.",
        "WebFlix Studio doesn't receive copyright events from the main app yet.",
        "This page mirrors studio.youtube.com claim structure and will populate when that feed exists.",
      ]}
    />
  );
}

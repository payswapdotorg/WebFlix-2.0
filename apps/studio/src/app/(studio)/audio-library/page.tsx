import { AudioLines } from "lucide-react";
import { DegradedSurface } from "@/components/degraded";

export default function AudioLibraryPage() {
  return (
    <DegradedSurface
      icon={AudioLines}
      title="Audio library"
      lines={[
        "Track catalog with genre/mood filters mirrors studio.youtube.com structure.",
        "The main-app API doesn't expose an audio track catalog yet — honest-empty.",
        "Tracks will appear here with real metadata once the upstream feed exists.",
      ]}
    />
  );
}

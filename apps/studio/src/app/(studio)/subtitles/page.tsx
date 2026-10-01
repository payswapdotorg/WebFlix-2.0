import { Captions } from "lucide-react";
import { DegradedSurface } from "@/components/degraded";

export default function SubtitlesPage() {
  return (
    <DegradedSurface
      icon={Captions}
      title="Subtitles"
      lines={[
        "Structure matches studio.youtube.com: per-video subtitle rows with language and state.",
        "The main-app API doesn't expose caption tracks yet, so this surface is honest-empty.",
        "Rows will populate automatically once caption data lands upstream — no placeholder rows are faked.",
      ]}
    />
  );
}

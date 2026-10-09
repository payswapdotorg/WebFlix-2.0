import type { Metadata } from "next";
import HelpView from "./view";

export const metadata: Metadata = { title: "Help" };

/**
 * WFX2-P20 — the help page shell.
 *
 * The page now mirrors the YouTube Help Center's structure at depth: a
 * hero search bar with popular-topic chips, a topic-card grid over the
 * real help topics (Getting started, Watching videos, Managing your
 * account, Privacy & safety, Troubleshooting — each card expands its
 * topic section on this page), client-side search over the topics with a
 * YouTube-parity empty state, and the contact-flow block with WebFlix's
 * honest-absence disclosure. The interactive surface lives in ./view.tsx;
 * every answer still describes something that really exists in WebFlix,
 * and questions about YouTube itself point at YouTube's own help center
 * instead of fabricating articles.
 */
export default function HelpPage() {
  return <HelpView />;
}

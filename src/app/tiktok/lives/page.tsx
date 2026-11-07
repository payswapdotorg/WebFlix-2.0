/**
 * P102 — the /tiktok/lives board (G27): the honest "who is live now" surface
 * over the WebFlix universe. The server shell carries the metadata and the
 * client view owns the poll (the board endpoint's probing/TTL laws live in
 * the API route; the view renders them honestly).
 */
import type { Metadata } from "next";

import { TikTokLivesBoardView } from "./view";

export const metadata: Metadata = {
  title: "TikTok lives — WebFlix",
  description:
    "The creators of the WebFlix universe who are live on TikTok right now, with in-app watch parties and honest outbound actions.",
};

export default function TikTokLivesPage() {
  return <TikTokLivesBoardView />;
}

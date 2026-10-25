import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // P52 — the report's §4 rung 8: the Netflix CDN joins the image optimizer,
  // so the hub's 200px thumbs stop loading full-res 1200×675 art. The big
  // art surfaces (card/backdrop/hero) ride next/image with real `sizes`;
  // the tiny pre-sized logo overlays stay plain <img> (nothing to optimize).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "dnm.nflximg.net",
      },
    ],
  },
};

export default nextConfig;

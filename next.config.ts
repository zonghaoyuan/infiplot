import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  turbopack: {
    root: __dirname,
  },
  // /public defaults to `max-age=0, must-revalidate`; pin the stable /home/* covers + first-act JSON for 1y so browsers/CDN stop re-downloading them.
  async headers() {
    return [
      {
        source: "/home/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default config;

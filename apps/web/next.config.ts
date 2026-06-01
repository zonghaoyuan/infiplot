import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  transpilePackages: [
    "@yume/engine",
    "@yume/ai-client",
    "@yume/types",
    "@yume/tts-client",
  ],
  serverExternalPackages: ["sharp"],
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default config;

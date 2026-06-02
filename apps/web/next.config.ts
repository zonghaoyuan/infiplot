import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  transpilePackages: [
    "@infiplot/engine",
    "@infiplot/ai-client",
    "@infiplot/types",
    "@infiplot/tts-client",
  ],
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default config;

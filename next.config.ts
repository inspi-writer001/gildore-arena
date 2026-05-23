import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/browser-session/start": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
  turbopack: {
    resolveAlias: {
      "@solana/kit/program-client-core":
        "./lib/shims/solana-program-client-core.ts",
    },
  },
};

export default nextConfig;

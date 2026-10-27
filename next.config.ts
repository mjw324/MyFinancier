import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // The AI assistant renders model text: even if markdown sanitizing
        // failed, the page must not load a remote image (a classic prompt-
        // injection exfiltration channel). Only images are restricted here.
        source: "/assistant",
        headers: [{ key: "Content-Security-Policy", value: "img-src 'self' data: blob:" }],
      },
    ];
  },
};

export default nextConfig;

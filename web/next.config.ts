import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/chi_sim"],
};

export default nextConfig;

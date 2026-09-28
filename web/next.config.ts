import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins,
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/chi_sim"],
};

export default nextConfig;

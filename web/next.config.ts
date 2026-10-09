import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep page generation and tracing within a small server's memory budget.
  experimental: { cpus: 1 },
  outputFileTracingExcludes: {
    "/*": [".env", ".env.*", "data/**/*", "test-results/**/*", "playwright-report/**/*"],
  },
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pdfjs-dist/cmaps/**/*", "./node_modules/pdfjs-dist/standard_fonts/**/*", "./node_modules/pdfjs-dist/wasm/**/*"],
  },
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins,
  serverExternalPackages: ["tesseract.js", "@tesseract.js-data/chi_sim"],
};

export default nextConfig;

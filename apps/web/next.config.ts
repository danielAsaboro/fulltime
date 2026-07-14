import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.FULLTIME_NEXT_DIST_DIR?.trim() || ".next",
  output: "standalone",
  transpilePackages: ["@fulltime/shared"],
  // The desktop-owned loopback host is the only supported browser origin.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

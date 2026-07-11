import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@fulltime/shared"],
  // The desktop-owned loopback host is the only supported browser origin.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fulltime/shared"],
  // Allow phone/LAN access to dev resources (HMR, /_next/*). Add your Mac's LAN IP
  // here if it changes (`ipconfig getifaddr en0`).
  allowedDevOrigins: ["192.168.0.141", "192.168.1.141", "localhost"],
};

export default nextConfig;

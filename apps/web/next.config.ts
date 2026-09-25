import type { NextConfig } from "next";

const config: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  allowedDevOrigins: ["127.0.0.1", "localhost", "100.100.42.67"],
  transpilePackages: ["@pm-studio/core"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } }
};

export default config;

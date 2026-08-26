import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@pm-studio/core"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } }
};

export default config;

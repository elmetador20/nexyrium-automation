import type { NextConfig } from "next";
import path from "node:path";

const dashboardRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: dashboardRoot,
  turbopack: {
    root: dashboardRoot,
  },
};

export default nextConfig;

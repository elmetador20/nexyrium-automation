import type { NextConfig } from "next";

// Next compiles this TypeScript config as an ES module, where __dirname is not
// available. The config is run from the dashboard project directory by npm,
// Docker, and Render, so cwd is the portable absolute project root on both
// Windows and Linux.
const dashboardRoot = process.cwd();
const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  // Vercel's Next.js adapter manages the .next output itself. The standalone
  // artifact is only needed by the repository's Docker image.
  ...(isVercel ? {} : {
    output: "standalone",
    outputFileTracingRoot: dashboardRoot,
  }),
  turbopack: {
    root: dashboardRoot,
  },
};

export default nextConfig;

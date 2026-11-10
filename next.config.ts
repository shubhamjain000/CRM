import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // This 4GB sandbox OOM-kills next-server whenever the browser runs alongside
  // it. Cap Turbopack's heap so it GCs harder — this caps BOTH the dev server
  // and PRODUCTION builds (`next build`, run by the deploy pipeline on this
  // same box). Without caps the dev server grows to ~2.9GB and the publish
  // build gets OOM-killed ("there was a problem deploying the code").
  experimental: {
    turbopackMemoryLimit: 1024,
    // Disk-backed cache for the dev server: compiled artifacts live on disk
    // instead of anonymous RAM (mmap'd pages are reclaimable page cache).
    // NOTE: the BUILD-side cache (turbopackFileSystemCacheForBuild) is
    // deliberately OFF — enabling it OOM-killed `next build` during the
    // "Collecting page data" phase on this 4GB box.
    turbopackFileSystemCacheForDev: true,
  },
  // distDir override for safe test builds (NEXT_DIST_DIR=.next-test bunx next
  // build) — production deploys and the dev server always use the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

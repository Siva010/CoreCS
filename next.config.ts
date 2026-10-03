import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Every route is prerendered at build time (no SSR, no middleware, no image
  // optimization, and both route handlers are force-static), so the site ships
  // as plain files in /out and needs no server at runtime.
  output: "export",
  // Caching headers are a server feature and aren't emitted by `output: export`;
  // they live in public/_headers, which Cloudflare applies to static assets.
};

export default nextConfig;

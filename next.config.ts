import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Content is read from /content at build time by server components.
  outputFileTracingIncludes: {
    "/**": ["./content/**/*"],
  },
  async headers() {
    return [
      {
        // PGlite (Postgres compiled to WASM) is large. The path isn't versioned, so
        // cache for a day and revalidate (cheap 304s) rather than marking it immutable.
        source: "/vendor/pglite/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;

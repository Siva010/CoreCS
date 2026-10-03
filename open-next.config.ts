import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Every route here is prerendered at build time (`next build` reports only
// Static and SSG pages) and nothing revalidates at runtime, so the prerendered
// payloads are served straight from Workers static assets. Without an
// incremental cache the Worker can't find them and SSG routes 404.
//
// No revalidation also means no queue and no WORKER_SELF_REFERENCE binding —
// the binding wrangler's auto-generated config pointed at a non-existent Worker.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});

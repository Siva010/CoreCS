import { buildSearchDocs } from "@/lib/content/loader";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildSearchDocs());
}

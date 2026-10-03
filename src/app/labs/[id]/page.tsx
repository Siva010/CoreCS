import { WidgetPage } from "@/components/pages/WidgetPages";
import { getWidget, WIDGETS } from "@/lib/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return WIDGETS.filter((w) => w.kinds.includes("lab")).map((w) => ({ id: w.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = getWidget(id);
  return { title: w?.title ?? "Not found", description: w?.description };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WidgetPage id={id} kind="lab" />;
}

import { LessonPage, lessonMetadata, lessonParams } from "@/components/lesson/LessonPage";

export const dynamicParams = false;

export function generateStaticParams() {
  return lessonParams("x");
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return lessonMetadata("x", slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LessonPage subject="x" slug={slug} />;
}

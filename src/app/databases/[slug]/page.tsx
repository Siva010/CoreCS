import { LessonPage, lessonMetadata, lessonParams } from "@/components/lesson/LessonPage";

export const dynamicParams = false;

export function generateStaticParams() {
  return lessonParams("db");
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return lessonMetadata("db", slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LessonPage subject="db" slug={slug} />;
}

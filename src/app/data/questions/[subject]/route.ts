import { getPracticeForSubject, getQuestionsForSubject } from "@/lib/content/loader";
import type { SubjectId } from "@/lib/content/types";

export const dynamic = "force-static";
export const dynamicParams = false;

const SUBJECTS: SubjectId[] = ["os", "cn", "db", "x"];

export function generateStaticParams() {
  return SUBJECTS.map((subject) => ({ subject }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params;
  if (!SUBJECTS.includes(subject as SubjectId)) return new Response("Not found", { status: 404 });
  const [questions, practice] = await Promise.all([getQuestionsForSubject(subject as SubjectId), getPracticeForSubject(subject as SubjectId)]);
  return Response.json({ questions, practice });
}

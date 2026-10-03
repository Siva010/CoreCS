"use client";
import type { PracticeData, QuestionData, SubjectId } from "@/lib/content/types";

const cache = new Map<SubjectId, Promise<{ questions: QuestionData[]; practice: PracticeData[] }>>();

/** Lazily fetches the rendered question bank for a subject (static JSON). */
export function loadSubjectQuestions(subject: SubjectId) {
  if (!cache.has(subject)) {
    cache.set(
      subject,
      fetch(`/data/questions/${subject}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load questions for ${subject}`);
        return r.json();
      }),
    );
  }
  return cache.get(subject)!;
}

export async function loadQuestions(subjects: SubjectId[]): Promise<QuestionData[]> {
  const all = await Promise.all(subjects.map((s) => loadSubjectQuestions(s)));
  return all.flatMap((a) => a.questions);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mastery estimation. Deliberately simple and explainable: a learner should be
// able to read the rule and agree with the label. It is a study signal, not a
// certificate.
import type { AreaDef, Depth, Stage, SubjectId } from "@/lib/content/types";
import type { ProgressData } from "./store";
import { GRADE_SCORE } from "./srs";

export interface ManifestLesson {
  id: string;
  title: string;
  href: string;
  subject: SubjectId;
  level: number;
  order: number;
  stage: Stage;
  depth: Depth;
  minutes: number;
  questionCount: number;
  prerequisites: string[];
}

export interface ManifestSubject {
  id: SubjectId;
  path: string;
  title: string;
  short: string;
  levels: { n: number; title: string; track?: "sql" }[];
  areas: AreaDef[];
}

export interface Manifest {
  lessons: ManifestLesson[];
  subjects: ManifestSubject[];
  roadmaps: { id: string; title: string; lessons: string[] }[];
}

export type MasteryLabel = "Not started" | "Learning" | "Needs revision" | "Intermediate" | "Strong";

export const LABEL_STYLE: Record<MasteryLabel, string> = {
  "Not started": "text-subtle",
  Learning: "text-d-core",
  "Needs revision": "text-warn",
  Intermediate: "text-accent",
  Strong: "text-ok",
};

const DAY = 86_400_000;

export interface LessonStats {
  completed: boolean;
  attempted: number;
  perf: number | null;
  lapses: number;
  due: number;
  lastActivity: number | null;
}

export function lessonStats(lessonId: string, s: ProgressData, now = Date.now()): LessonStats {
  let sum = 0;
  let n = 0;
  let lapses = 0;
  let due = 0;
  let last: number | null = s.lessons[lessonId]?.completedAt ?? s.lessons[lessonId]?.lastRevisedAt ?? null;
  for (const q of Object.values(s.questions)) {
    if (q.lessonId !== lessonId || !q.attempts.length) continue;
    const latest = q.attempts[q.attempts.length - 1];
    sum += GRADE_SCORE[latest.grade];
    n += 1;
    lapses += q.srs.lapses;
    if (q.srs.due <= now) due += 1;
    last = Math.max(last ?? 0, latest.t);
  }
  for (const results of Object.values(s.practice)) {
    if (!results.length || results[0].lessonId !== lessonId) continue;
    const latest = results[results.length - 1];
    sum += latest.correct ? 1 : 0;
    n += 1;
    last = Math.max(last ?? 0, latest.t);
  }
  return { completed: !!s.lessons[lessonId]?.completedAt, attempted: n, perf: n ? sum / n : null, lapses, due, lastActivity: last };
}

export interface GroupMastery {
  score: number; // 0–100
  coverage: number; // 0–1
  perf: number | null;
  label: MasteryLabel;
  completed: number;
  total: number;
  attempted: number;
  totalQuestions: number;
  due: number;
  lastActivity: number | null;
}

export function groupMastery(lessons: ManifestLesson[], s: ProgressData, now = Date.now()): GroupMastery {
  let completed = 0;
  let attempted = 0;
  let perfSum = 0;
  let due = 0;
  let last: number | null = null;
  let totalQuestions = 0;
  for (const l of lessons) {
    const st = lessonStats(l.id, s, now);
    totalQuestions += l.questionCount;
    if (st.completed) completed += 1;
    if (st.perf !== null) {
      attempted += st.attempted;
      perfSum += st.perf * st.attempted;
    }
    due += st.due;
    if (st.lastActivity) last = Math.max(last ?? 0, st.lastActivity);
  }
  const total = lessons.length;
  const coverage = total ? completed / total : 0;
  const perf = attempted ? perfSum / attempted : null;
  const evidence = Math.min(1, attempted / Math.max(3, totalQuestions * 0.35));
  const score = Math.round(100 * (0.45 * coverage + 0.55 * (perf ?? 0) * evidence));

  let label: MasteryLabel;
  const stale = last !== null && now - last > 30 * DAY;
  if (!completed && !attempted) label = "Not started";
  else if (attempted < 3) label = "Learning";
  else if ((perf ?? 0) < 0.6 || stale || due > Math.max(3, attempted * 0.5)) label = "Needs revision";
  else if ((perf ?? 0) >= 0.8 && coverage >= 0.6) label = "Strong";
  else label = "Intermediate";

  return { score, coverage, perf, label, completed, total, attempted, totalQuestions, due, lastActivity: last };
}

export function areaLessons(m: Manifest, subject: SubjectId, area: AreaDef): ManifestLesson[] {
  return m.lessons.filter((l) => l.subject === subject && area.levels.includes(l.level));
}

export interface WeakTopic {
  lesson: ManifestLesson;
  perf: number;
  lapses: number;
  reason: string;
}

export function weakTopics(m: Manifest, s: ProgressData, now = Date.now()): WeakTopic[] {
  const out: WeakTopic[] = [];
  for (const l of m.lessons) {
    const st = lessonStats(l.id, s, now);
    if (st.perf === null || st.attempted < 2) continue;
    if (st.perf < 0.6) out.push({ lesson: l, perf: st.perf, lapses: st.lapses, reason: `Answer quality ${Math.round(st.perf * 100)}%` });
    else if (st.lapses >= 2) out.push({ lesson: l, perf: st.perf, lapses: st.lapses, reason: `Forgotten ${st.lapses}× in review` });
  }
  return out.sort((a, b) => a.perf - b.perf).slice(0, 8);
}

export function roadmapReadiness(m: Manifest, s: ProgressData, lessonIds: string[], now = Date.now()) {
  const byId = new Map(m.lessons.map((l) => [l.id, l]));
  const lessons = lessonIds.map((id) => byId.get(id)).filter((l): l is ManifestLesson => !!l);
  const g = groupMastery(lessons, s, now);
  const gaps = lessons
    .map((l) => ({ l, st: lessonStats(l.id, s, now) }))
    .filter(({ st }) => !st.completed || st.perf === null || st.perf < 0.6)
    .map(({ l, st }) => ({
      lesson: l,
      why: !st.completed ? "Not completed" : st.perf === null ? "No questions answered yet" : `Weak answers (${Math.round(st.perf * 100)}%)`,
    }));
  return { ...g, gaps };
}

export function suggestedRevisions(m: Manifest, s: ProgressData, now = Date.now()) {
  return m.lessons
    .filter((l) => {
      const p = s.lessons[l.id];
      if (!p?.completedAt) return false;
      const last = Math.max(p.completedAt, p.lastRevisedAt ?? 0);
      return now - last > 14 * DAY;
    })
    .slice(0, 10);
}

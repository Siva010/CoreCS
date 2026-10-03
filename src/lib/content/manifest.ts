import type { Manifest } from "@/lib/progress/mastery";
import { getAllLessons, getRoadmaps, getSubjects } from "./loader";

/** Compact curriculum description passed to client components. */
export function getManifest(): Manifest {
  return {
    lessons: getAllLessons().map((l) => ({
      id: l.id,
      title: l.title,
      href: l.href,
      subject: l.subject,
      level: l.level,
      order: l.order,
      stage: l.stage,
      depth: l.depth,
      minutes: l.minutes,
      questionCount: l.questionCount,
      prerequisites: l.prerequisites,
    })),
    subjects: getSubjects().map((s) => ({
      id: s.id,
      path: s.path,
      title: s.title,
      short: s.short,
      levels: s.levels.map((l) => ({ n: l.n, title: l.title, track: l.track })),
      areas: s.areas,
    })),
    roadmaps: getRoadmaps().map((r) => ({ id: r.id, title: r.title, lessons: [...new Set(r.phases.flatMap((p) => p.lessons))] })),
  };
}

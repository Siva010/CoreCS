// A compact SM-2-style spaced-repetition scheduler.
// Grades: 0 = Again (couldn't answer), 1 = Hard, 2 = Good, 3 = Easy.

export type Grade = 0 | 1 | 2 | 3;

export const GRADE_LABELS: Record<Grade, string> = {
  0: "Again",
  1: "Hard",
  2: "Good",
  3: "Easy",
};

export const GRADE_HINTS: Record<Grade, string> = {
  0: "I couldn't explain it",
  1: "Partially, with gaps",
  2: "Explained it correctly",
  3: "Effortless, with follow-ups",
};

/** Score used for mastery estimates. */
export const GRADE_SCORE: Record<Grade, number> = { 0: 0, 1: 0.45, 2: 0.85, 3: 1 };

export interface SrsState {
  ease: number;
  interval: number; // days
  due: number; // epoch ms
  reps: number;
  lapses: number;
}

const DAY = 86_400_000;
const MIN = 60_000;

export function schedule(prev: SrsState | undefined, grade: Grade, now = Date.now()): SrsState {
  const s: SrsState = prev ? { ...prev } : { ease: 2.5, interval: 0, due: now, reps: 0, lapses: 0 };
  if (grade === 0) {
    s.lapses += prev ? 1 : 0;
    s.reps = 0;
    s.interval = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + 10 * MIN;
    return s;
  }
  if (grade === 1) {
    s.interval = s.reps === 0 ? 1 : Math.max(1, s.interval * 1.2);
    s.ease = Math.max(1.3, s.ease - 0.15);
  } else if (grade === 2) {
    s.interval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : s.interval * s.ease;
  } else {
    s.interval = s.reps === 0 ? 3 : s.reps === 1 ? 6 : s.interval * s.ease * 1.3;
    s.ease = Math.min(3.0, s.ease + 0.15);
  }
  s.reps += 1;
  s.interval = Math.min(s.interval, 180);
  s.due = now + Math.round(s.interval * DAY);
  return s;
}

export function formatDue(due: number, now = Date.now()): string {
  const d = due - now;
  if (d <= 0) return "due now";
  if (d < 60 * MIN) return `in ${Math.ceil(d / MIN)} min`;
  if (d < DAY) return `in ${Math.ceil(d / (60 * MIN))} h`;
  return `in ${Math.round(d / DAY)} d`;
}

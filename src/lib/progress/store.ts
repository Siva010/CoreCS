"use client";
// Client-side learner state, persisted to localStorage. Nothing leaves the
// browser. Hydration is manual (skipHydration) so server-rendered markup never
// disagrees with the first client render; see ProgressHydrator.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Depth, RevisionMode } from "@/lib/content/types";
import { schedule, type Grade, type SrsState } from "./srs";

export interface Attempt {
  t: number;
  grade: Grade;
  source: "lesson" | "drill" | "review" | "mock";
}

export interface QuestionProgress {
  lessonId: string;
  attempts: Attempt[];
  srs: SrsState;
}

export interface LessonProgress {
  visitedAt?: number;
  completedAt?: number;
  lastRevisedAt?: number;
  revisions: number;
}

export interface HistoryItem {
  t: number;
  kind: "lesson-complete" | "drill" | "review" | "practice" | "lab" | "revision";
  title: string;
  href?: string;
  detail?: string;
  right?: number;
  total?: number;
}

export interface ProgressData {
  version: 1;
  lessons: Record<string, LessonProgress>;
  questions: Record<string, QuestionProgress>;
  practice: Record<string, { t: number; correct: boolean; lessonId: string }[]>;
  bookmarks: string[];
  history: HistoryItem[];
  prefs: { maxDepth: Depth; revisionMode: RevisionMode };
}

interface ProgressActions {
  visitLesson(id: string): void;
  completeLesson(id: string, title: string, href: string): void;
  uncompleteLesson(id: string): void;
  markRevised(id: string, mode: RevisionMode, title: string, href: string): void;
  gradeQuestion(qid: string, lessonId: string, grade: Grade, source: Attempt["source"]): void;
  recordPractice(pid: string, lessonId: string, correct: boolean): void;
  toggleBookmark(key: string): void;
  logHistory(item: Omit<HistoryItem, "t">): void;
  setMaxDepth(d: Depth): void;
  setRevisionMode(m: RevisionMode): void;
  resetAll(): void;
  importData(data: ProgressData): void;
}

export type ProgressState = ProgressData & ProgressActions;

const initial: ProgressData = {
  version: 1,
  lessons: {},
  questions: {},
  practice: {},
  bookmarks: [],
  history: [],
  prefs: { maxDepth: "senior", revisionMode: "deep" },
};

const MAX_HISTORY = 300;

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      ...initial,
      visitLesson: (id) =>
        set((s) => ({ lessons: { ...s.lessons, [id]: { ...(s.lessons[id] ?? { revisions: 0 }), visitedAt: Date.now() } } })),
      completeLesson: (id, title, href) =>
        set((s) => {
          const prev = s.lessons[id] ?? { revisions: 0 };
          if (prev.completedAt) return {};
          return {
            lessons: { ...s.lessons, [id]: { ...prev, completedAt: Date.now() } },
            history: [{ t: Date.now(), kind: "lesson-complete" as const, title, href }, ...s.history].slice(0, MAX_HISTORY),
          };
        }),
      uncompleteLesson: (id) =>
        set((s) => {
          const prev = s.lessons[id];
          if (!prev) return {};
          const next = { ...prev };
          delete next.completedAt;
          return { lessons: { ...s.lessons, [id]: next } };
        }),
      markRevised: (id, mode, title, href) =>
        set((s) => {
          const prev = s.lessons[id] ?? { revisions: 0 };
          return {
            lessons: { ...s.lessons, [id]: { ...prev, lastRevisedAt: Date.now(), revisions: prev.revisions + 1 } },
            history: [{ t: Date.now(), kind: "revision" as const, title, href, detail: mode === "deep" ? "Deep dive" : `${mode}-minute revision` }, ...s.history].slice(0, MAX_HISTORY),
          };
        }),
      gradeQuestion: (qid, lessonId, grade, source) =>
        set((s) => {
          const prev = s.questions[qid];
          const now = Date.now();
          const attempts = [...(prev?.attempts ?? []), { t: now, grade, source }].slice(-20);
          return { questions: { ...s.questions, [qid]: { lessonId, attempts, srs: schedule(prev?.srs, grade, now) } } };
        }),
      recordPractice: (pid, lessonId, correct) =>
        set((s) => ({ practice: { ...s.practice, [pid]: [...(s.practice[pid] ?? []), { t: Date.now(), correct, lessonId }].slice(-10) } })),
      toggleBookmark: (key) =>
        set((s) => ({ bookmarks: s.bookmarks.includes(key) ? s.bookmarks.filter((b) => b !== key) : [key, ...s.bookmarks] })),
      logHistory: (item) => set((s) => ({ history: [{ ...item, t: Date.now() }, ...s.history].slice(0, MAX_HISTORY) })),
      setMaxDepth: (d) => set((s) => ({ prefs: { ...s.prefs, maxDepth: d } })),
      setRevisionMode: (m) => set((s) => ({ prefs: { ...s.prefs, revisionMode: m } })),
      resetAll: () => set({ ...initial }),
      importData: (data) => set({ ...initial, ...data, version: 1 }),
    }),
    {
      name: "ccia-progress-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        version: s.version,
        lessons: s.lessons,
        questions: s.questions,
        practice: s.practice,
        bookmarks: s.bookmarks,
        history: s.history,
        prefs: s.prefs,
      }),
    },
  ),
);

/** True once localStorage state has been loaded on the client. */
export const useHydrated = create<{ hydrated: boolean; setHydrated: () => void }>((set) => ({
  hydrated: false,
  setHydrated: () => set({ hydrated: true }),
}));

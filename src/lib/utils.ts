import { clsx, type ClassValue } from "clsx";
import type { Depth, Relevance, SubjectId } from "@/lib/content/types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export const DEPTH_META: Record<Depth, { emoji: string; label: string; short: string; text: string; bg: string; border: string; blurb: string }> = {
  beginner: {
    emoji: "🟢",
    label: "Beginner",
    short: "Beginner",
    text: "text-d-beginner",
    bg: "bg-d-beginner/10",
    border: "border-d-beginner/40",
    blurb: "Foundational mental models. No prior knowledge assumed.",
  },
  core: {
    emoji: "🔵",
    label: "Interview Core",
    short: "Core",
    text: "text-d-core",
    bg: "bg-d-core/10",
    border: "border-d-core/40",
    blurb: "What standard SDE interviews expect you to explain and apply.",
  },
  advanced: {
    emoji: "🟣",
    label: "Advanced",
    short: "Advanced",
    text: "text-d-advanced",
    bg: "bg-d-advanced/10",
    border: "border-d-advanced/40",
    blurb: "Engineering depth for backend roles and follow-up-heavy interviews.",
  },
  senior: {
    emoji: "🔴",
    label: "Senior Touch",
    short: "Senior",
    text: "text-d-senior",
    bg: "bg-d-senior/10",
    border: "border-d-senior/40",
    blurb: "Conceptual awareness of senior-level trade-offs. Not a substitute for experience.",
  },
};

export const RELEVANCE_META: Record<Relevance, { label: string; dots: number }> = {
  essential: { label: "Asked constantly", dots: 4 },
  high: { label: "Frequently asked", dots: 3 },
  medium: { label: "Sometimes asked", dots: 2 },
  low: { label: "Rarely asked directly", dots: 1 },
};

export const DIFFICULTY_LABELS = ["", "Introductory", "Easy", "Moderate", "Challenging", "Hard"];

export const SUBJECT_STYLE: Record<SubjectId, { text: string; bg: string; border: string; dot: string; ring: string }> = {
  os: { text: "text-os", bg: "bg-os/10", border: "border-os/40", dot: "bg-os", ring: "ring-os/40" },
  cn: { text: "text-cn", bg: "bg-cn/10", border: "border-cn/40", dot: "bg-cn", ring: "ring-cn/40" },
  db: { text: "text-db", bg: "bg-db/10", border: "border-db/40", dot: "bg-db", ring: "ring-db/40" },
  x: { text: "text-x", bg: "bg-x/10", border: "border-x/40", dot: "bg-x", ring: "ring-x/40" },
};

export const SUBJECT_PATHS: Record<SubjectId, string> = { os: "os", cn: "networks", db: "databases", x: "connections" };
export const SUBJECT_SHORT: Record<SubjectId, string> = { os: "OS", cn: "Networks", db: "Databases", x: "Connections" };

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function timeAgo(t: number, now = Date.now()): string {
  const d = now - t;
  const min = 60_000;
  if (d < min) return "just now";
  if (d < 60 * min) return `${Math.floor(d / min)} min ago`;
  if (d < 24 * 60 * min) return `${Math.floor(d / (60 * min))} h ago`;
  const days = Math.floor(d / (24 * 60 * min));
  if (days < 30) return `${days} d ago`;
  return new Date(t).toLocaleDateString();
}

export function bar(fraction: number, width = 10): string {
  const f = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(f * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

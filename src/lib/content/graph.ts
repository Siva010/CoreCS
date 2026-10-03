// Layered layout for the prerequisite DAG (a light Sugiyama: longest-path
// layering + barycenter ordering). Pure; runs on the server.
import type { LessonMeta, SubjectId } from "./types";

export interface DagNode {
  id: string;
  title: string;
  href: string;
  subject: SubjectId;
  level: number;
  layer: number;
  row: number;
}

export interface DagLayout {
  nodes: DagNode[];
  edges: { from: string; to: string }[];
  layers: number;
  maxRows: number;
}

export function layoutDag(lessons: LessonMeta[]): DagLayout {
  const ids = new Set(lessons.map((l) => l.id));
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const prereqs = (l: LessonMeta) => l.prerequisites.filter((p) => ids.has(p));

  const layer = new Map<string, number>();
  const compute = (id: string, seen: Set<string>): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (seen.has(id)) return 0; // cycle guard (validator reports cycles)
    seen.add(id);
    const l = byId.get(id)!;
    const ps = prereqs(l);
    const v = ps.length ? Math.max(...ps.map((p) => compute(p, seen) + 1)) : 0;
    layer.set(id, v);
    return v;
  };
  for (const l of lessons) compute(l.id, new Set());

  const layers: string[][] = [];
  for (const l of lessons) {
    const k = layer.get(l.id)!;
    (layers[k] ??= []).push(l.id);
  }
  // barycenter ordering, two sweeps
  const pos = new Map<string, number>();
  layers.forEach((ls) => ls.forEach((id, i) => pos.set(id, i)));
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let k = 1; k < layers.length; k++) {
      const scored = (layers[k] ?? []).map((id) => {
        const ps = prereqs(byId.get(id)!);
        const bc = ps.length ? ps.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / ps.length : pos.get(id)!;
        return { id, bc };
      });
      scored.sort((a, b) => a.bc - b.bc);
      layers[k] = scored.map((s) => s.id);
      layers[k].forEach((id, i) => pos.set(id, i));
    }
  }

  const nodes: DagNode[] = [];
  layers.forEach((ls, k) =>
    (ls ?? []).forEach((id, row) => {
      const l = byId.get(id)!;
      nodes.push({ id, title: l.title, href: l.href, subject: l.subject, level: l.level, layer: k, row });
    }),
  );
  const edges = lessons.flatMap((l) => prereqs(l).map((p) => ({ from: p, to: l.id })));
  return { nodes, edges, layers: layers.length, maxRows: Math.max(0, ...layers.map((l) => l?.length ?? 0)) };
}

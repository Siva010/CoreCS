// Extendible hashing as in Ramakrishnan & Gehrke: h(k) = k, and the directory
// is indexed by the last `globalDepth` bits of the hash. A full bucket splits
// on one more bit; if its local depth already equals the global depth, the
// directory doubles first. Every change is recorded as a readable step.

export interface Bucket {
  id: number;
  localDepth: number;
  keys: number[];
}

export interface HashState {
  globalDepth: number;
  /** directory[i] = id of the bucket that slot i (the last globalDepth bits) points to. */
  directory: number[];
  buckets: Bucket[];
  capacity: number;
  nextId: number;
}

export interface HashEvent {
  kind: "insert" | "split" | "double" | "overflow" | "delete" | "missing";
  text: string;
}

/** Deepest the directory may grow; past this, a bucket of identical low bits overflows instead. */
export const MAX_GLOBAL_DEPTH = 5;

export const bits = (n: number, width: number) => (width <= 0 ? "" : (n & ((1 << width) - 1)).toString(2).padStart(width, "0"));

export function emptyHash(capacity: number, globalDepth = 1): HashState {
  const size = 1 << globalDepth;
  return {
    globalDepth,
    directory: Array.from({ length: size }, (_, i) => i),
    buckets: Array.from({ length: size }, (_, i) => ({ id: i, localDepth: globalDepth, keys: [] })),
    capacity,
    nextId: size,
  };
}

function clone(s: HashState): HashState {
  return { ...s, directory: [...s.directory], buckets: s.buckets.map((b) => ({ ...b, keys: [...b.keys] })) };
}

export const slotOf = (s: HashState, key: number) => key & ((1 << s.globalDepth) - 1);
export const bucketName = (id: number) => `B${id}`;

export function insertKey(prev: HashState, key: number): { state: HashState; events: HashEvent[] } {
  const s = clone(prev);
  const events: HashEvent[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const slot = slotOf(s, key);
    const b = s.buckets.find((x) => x.id === s.directory[slot])!;
    if (b.keys.length < s.capacity) {
      b.keys.push(key);
      events.push({
        kind: "insert",
        text: `h(${key}) = ${key.toString(2)}₂ → last ${s.globalDepth} bit${s.globalDepth === 1 ? "" : "s"} ${bits(key, s.globalDepth)} → slot ${bits(slot, s.globalDepth)} → ${bucketName(b.id)} (${b.keys.length}/${s.capacity}).`,
      });
      return { state: s, events };
    }
    if (b.localDepth === s.globalDepth) {
      const inseparable = b.keys.every((k) => bits(k, MAX_GLOBAL_DEPTH) === bits(key, MAX_GLOBAL_DEPTH));
      if (inseparable || s.globalDepth >= MAX_GLOBAL_DEPTH) {
        b.keys.push(key);
        events.push({
          kind: "overflow",
          text: inseparable
            ? `${bucketName(b.id)} is full, and ${key} and every key in it end in the same ${MAX_GLOBAL_DEPTH} bits (${bits(key, MAX_GLOBAL_DEPTH)}): no number of splits can separate them — that's the duplicate/skew problem. Real systems chain an overflow page; ${key} goes to ${bucketName(b.id)}'s overflow.`
            : `${bucketName(b.id)} is full and the directory is at this simulator's limit of ${1 << MAX_GLOBAL_DEPTH} slots, so ${key} goes to an overflow page chained to ${bucketName(b.id)}.`,
        });
        return { state: s, events };
      }
      s.directory = [...s.directory, ...s.directory];
      s.globalDepth++;
      events.push({
        kind: "double",
        text: `${bucketName(b.id)} is full and its local depth equals the global depth (${b.localDepth}), so one more bit can't be told apart by the directory: double it to ${s.directory.length} slots (global depth ${s.globalDepth}). Each new slot points where its twin did — no data moves.`,
      });
    }
    const bit = b.localDepth;
    const suffix = bits(s.directory.indexOf(b.id), bit);
    const nb: Bucket = { id: s.nextId++, localDepth: bit + 1, keys: [] };
    b.localDepth = bit + 1;
    const all = b.keys;
    b.keys = all.filter((k) => ((k >> bit) & 1) === 0);
    nb.keys = all.filter((k) => ((k >> bit) & 1) === 1);
    s.buckets.push(nb);
    s.directory = s.directory.map((id, slot) => (id === b.id && ((slot >> bit) & 1) === 1 ? nb.id : id));
    events.push({
      kind: "split",
      text: `Split ${bucketName(b.id)} on one more bit: keys ending in …0${suffix} stay [${b.keys.join(", ")}], keys ending in …1${suffix} move to new ${bucketName(nb.id)} [${nb.keys.join(", ")}]. Both now have local depth ${bit + 1}, and the directory slots that end in 1${suffix} are re-pointed to ${bucketName(nb.id)}.`,
    });
  }
  return { state: s, events };
}

export function deleteKey(prev: HashState, key: number): { state: HashState; events: HashEvent[] } {
  const s = clone(prev);
  const slot = slotOf(s, key);
  const b = s.buckets.find((x) => x.id === s.directory[slot])!;
  const at = b.keys.indexOf(key);
  if (at < 0) return { state: prev, events: [{ kind: "missing", text: `${key} isn't in ${bucketName(b.id)} (slot ${bits(slot, s.globalDepth)}), so it isn't stored anywhere — one bucket read proves it.` }] };
  b.keys.splice(at, 1);
  return {
    state: s,
    events: [{ kind: "delete", text: `Deleted ${key} from ${bucketName(b.id)}. (Most implementations don't merge buckets or halve the directory on delete; space comes back only on reorganisation.)` }],
  };
}

/** Distinct directory slots pointing at each bucket: 2^(global − local). */
export const pointersTo = (s: HashState, id: number) => s.directory.filter((x) => x === id).length;

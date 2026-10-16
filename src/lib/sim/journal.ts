// Crash consistency for one append: the file grows by one data block, so three
// blocks must change together — the data block D, the inode I (new size and
// pointer) and the free-space bitmap B. Simulates a crash at any point with no
// journal, or with ext4's three journaling modes, then recovery.
// Pure functions, shared by the Journaling lab and checkable with tsx.

export type JMode = "none" | "writeback" | "ordered" | "journal";
export type Home = "I" | "B" | "D";

export interface DiskState {
  home: Record<Home, boolean>; // true: the new version reached its home location
  journal: { txb: boolean; I: boolean; B: boolean; D: boolean; txe: boolean };
}

export interface Step {
  title: string;
  detail: string;
  apply: (s: DiskState) => void;
}

const empty = (): DiskState => ({ home: { I: false, B: false, D: false }, journal: { txb: false, I: false, B: false, D: false, txe: false } });

export function steps(mode: JMode): Step[] {
  const logMeta = (withData: boolean): Step => ({
    title: withData ? "Log the transaction" : "Log the metadata",
    detail: withData ? "Write TxB, I′, B′ and D′ into the journal. Then flush, so they are on disk before anything else." : "Write TxB, I′ and B′ into the journal.",
    apply: (s) => Object.assign(s.journal, { txb: true, I: true, B: true, D: withData }),
  });
  const commit: Step = {
    title: "Commit",
    detail: "Write the commit block TxE, and flush. From this moment the transaction counts as done.",
    apply: (s) => (s.journal.txe = true),
  };
  const checkpoint = (withData: boolean): Step => ({
    title: "Checkpoint",
    detail: withData ? "Copy I′, B′ and D′ from the journal to their home locations." : "Copy I′ and B′ to their home locations.",
    apply: (s) => Object.assign(s.home, { I: true, B: true, ...(withData ? { D: true } : {}) }),
  });
  const free: Step = {
    title: "Free",
    detail: "Mark the transaction's journal space reusable.",
    apply: (s) => Object.assign(s.journal, { txb: false, I: false, B: false, D: false, txe: false }),
  };
  if (mode === "journal") return [logMeta(true), commit, checkpoint(true), free];
  if (mode === "ordered")
    return [
      {
        title: "Write the data, log the metadata",
        detail: "Write D′ to its home location and TxB, I′, B′ to the journal, then flush. The data must be on disk before the commit.",
        apply: (s) => {
          s.home.D = true;
          Object.assign(s.journal, { txb: true, I: true, B: true });
        },
      },
      commit,
      checkpoint(false),
      free,
    ];
  if (mode === "writeback")
    return [
      logMeta(false),
      commit,
      checkpoint(false),
      {
        title: "Write the data (whenever)",
        detail: "Writeback mode doesn't order data with metadata. Here D′ reaches the disk last, which is allowed.",
        apply: (s) => (s.home.D = true),
      },
      free,
    ];
  return [];
}

/** Disk contents if the machine crashes after `done` steps. */
export function crashAfter(mode: JMode, done: number): DiskState {
  const s = empty();
  steps(mode)
    .slice(0, done)
    .forEach((st) => st.apply(s));
  return s;
}

export interface Recovery {
  action: string;
  after: DiskState;
}

/** Journal recovery: replay a committed transaction, discard an uncommitted one. */
export function recover(s: DiskState): Recovery {
  const after: DiskState = { home: { ...s.home }, journal: { ...s.journal } };
  if (s.journal.txe) {
    after.home.I = true;
    after.home.B = true;
    if (s.journal.D) after.home.D = true;
    after.journal = { txb: false, I: false, B: false, D: false, txe: false };
    return { action: `Commit block found: replay ${s.journal.D ? "I′, B′ and D′" : "I′ and B′"} to their home locations. Replaying is idempotent, so it doesn't matter if some were already there.`, after };
  }
  if (s.journal.txb) {
    after.journal = { txb: false, I: false, B: false, D: false, txe: false };
    return { action: "No commit block: discard the transaction. The metadata it logged was never copied home, so the old metadata is intact.", after };
  }
  return { action: "The journal holds no transaction for this append, so there is nothing to replay.", after };
}

/** What fsck does with no journal: trust the inode, so the bitmap is made to agree with it. */
export function fsck(s: DiskState): Recovery {
  const after: DiskState = { home: { ...s.home }, journal: { ...s.journal } };
  if (s.home.I && !s.home.B) {
    after.home.B = true;
    return { action: "fsck scans every inode and bitmap. The inode uses a block the bitmap calls free, so fsck marks it allocated.", after };
  }
  if (!s.home.I && s.home.B) {
    after.home.B = false;
    return { action: "fsck scans every inode and bitmap. A block is marked allocated but no inode uses it, so fsck frees it.", after };
  }
  return { action: "fsck scans every inode and bitmap and finds them in agreement.", after };
}

export type Tone = "good" | "warn" | "bad";

export interface Verdict {
  tone: Tone;
  consistent: boolean;
  text: string;
}

/** What the file and the filesystem look like in this state. */
export function judge(s: DiskState): Verdict {
  const { I, B, D } = s.home;
  if (I !== B) {
    return I
      ? { tone: "bad", consistent: false, text: "Inconsistent: the inode uses a block the bitmap calls free, so the next file to be created could be given the same block." }
      : { tone: "bad", consistent: false, text: "Inconsistent: the bitmap marks a block allocated that no file uses, so the space leaks." };
  }
  if (!I) return { tone: "warn", consistent: true, text: D ? "Consistent, and the file is unchanged: the append is lost. D′ sits in a block the bitmap still calls free, which is harmless." : "Consistent, and the file is unchanged: the append is lost." };
  if (!D) return { tone: "bad", consistent: true, text: "Metadata is consistent, but the file now ends with a block that never received the new data: whatever stale bytes that block held, possibly another file's old data." };
  return { tone: "good", consistent: true, text: "Consistent, and the append is complete." };
}

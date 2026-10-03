// Browser-side access to PGlite (PostgreSQL compiled to WebAssembly).
//
// The database runs in a Web Worker (public/vendor/sql-worker.js) that loads
// PGlite from /vendor/pglite (copied there by scripts/copy-pglite.mjs). Running
// off the main thread keeps the page responsive, and because PGlite ignores
// statement_timeout, the only way to stop a runaway query (say, an infinite
// recursive CTE) is to terminate the worker — which this module does when a
// request exceeds its time budget.

export interface SqlField {
  name: string;
  dataTypeID: number;
}

export interface SqlResult<Row = unknown[]> {
  rows: Row[];
  fields: SqlField[];
  affectedRows?: number;
  command?: string;
  rowCount?: number;
}

export interface SqlError {
  message: string;
  detail?: string;
  hint?: string;
  position?: string | number;
  code?: string;
}

export class QueryTimeoutError extends Error {
  constructor(ms: number) {
    super(`Query cancelled after ${Math.round(ms / 1000)} s. PostgreSQL in the browser can't interrupt a running query, so the database was stopped and will be rebuilt.`);
    this.name = "QueryTimeoutError";
  }
}

export class DatabaseStoppedError extends Error {
  constructor() {
    super("The database is not running.");
    this.name = "DatabaseStoppedError";
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const INIT_TIMEOUT_MS = 180000;

export class SqlDatabase {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private stopped = false;

  constructor(private readonly onStop?: (reason: Error) => void) {
    this.worker = new Worker("/vendor/sql-worker.js", { type: "module" });
    this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: SqlError }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(Object.assign(new Error(e.data.error?.message ?? "Query failed"), e.data.error));
    };
    this.worker.onerror = (e) => this.stop(new Error(e.message || "The database worker crashed."));
  }

  get running() {
    return !this.stopped;
  }

  private call<T>(message: Record<string, unknown>, timeoutMs: number): Promise<T> {
    if (this.stopped) return Promise.reject(new DatabaseStoppedError());
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new QueryTimeoutError(timeoutMs)), timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.worker.postMessage({ id, ...message });
    });
  }

  init(seed: string) {
    return this.call<void>({ type: "init", seed }, INIT_TIMEOUT_MS);
  }

  /** Runs one or more statements; returns one result per statement (rows as arrays). */
  exec(sql: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this.call<SqlResult[]>({ type: "exec", sql, rowMode: "array" }, timeoutMs);
  }

  /** Runs a single statement with parameters; rows as objects. */
  query<Row = Record<string, unknown>>(sql: string, params: unknown[] = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this.call<SqlResult<Row>>({ type: "query", sql, params, rowMode: "object" }, timeoutMs);
  }

  /** Runs a single statement; rows as arrays (safe with duplicate column names). */
  queryArrays(sql: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this.call<SqlResult>({ type: "query", sql, rowMode: "array" }, timeoutMs);
  }

  stop(reason: Error = new DatabaseStoppedError()) {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
    this.onStop?.(reason);
  }
}

/** Starts a fresh in-memory PostgreSQL in a worker and runs the seed script. */
export async function createDatabase(seed: string, onStop?: (reason: Error) => void): Promise<SqlDatabase> {
  const db = new SqlDatabase(onStop);
  await db.init(seed);
  return db;
}

/** Turns an error from PGlite into a readable multi-line message. */
export function describeSqlError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as SqlError;
    const parts = [err.message ?? String(e)];
    if (err.detail) parts.push(`Detail: ${err.detail}`);
    if (err.hint) parts.push(`Hint: ${err.hint}`);
    return parts.join("\n");
  }
  return String(e);
}

/** Normalizes a value for display and for comparing query results. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace("T", " ").replace(".000Z", "Z");
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") {
    if (/^-?\d+(\.\d+)?$/.test(v)) {
      const n = Number(v);
      if (Number.isFinite(n)) return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
    }
    return v;
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Runs PGlite (PostgreSQL compiled to WebAssembly) off the main thread so a
// runaway query can't freeze the page: the page terminates this worker when a
// query exceeds its time budget and starts a fresh one.
let db = null;

function serializeError(err) {
  return {
    message: (err && err.message) || String(err),
    detail: err && err.detail,
    hint: err && err.hint,
    position: err && err.position,
    code: err && err.code,
  };
}

function serializeResult(r) {
  return { rows: r.rows, fields: r.fields, affectedRows: r.affectedRows, command: r.command, rowCount: r.rowCount };
}

self.onmessage = async (event) => {
  const { id, type, seed, sql, params, rowMode } = event.data;
  try {
    if (type === "init") {
      const { PGlite } = await import("./pglite/index.js");
      db = await PGlite.create();
      if (seed) await db.exec(seed);
      self.postMessage({ id, ok: true });
    } else if (type === "exec") {
      const results = await db.exec(sql, { rowMode: rowMode || "array" });
      self.postMessage({ id, ok: true, result: results.map(serializeResult) });
    } else if (type === "query") {
      const result = await db.query(sql, params || [], { rowMode: rowMode || "object" });
      self.postMessage({ id, ok: true, result: serializeResult(result) });
    } else {
      throw new Error(`Unknown request type: ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: serializeError(err) });
  }
};

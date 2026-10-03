import { PGlite } from "@electric-sql/pglite";
import { PLAYGROUND_SEED, PLAN_SEED } from "../src/lib/sql/seed";
import { SQL_EXERCISES } from "../src/lib/sql/exercises";
import { formatValue } from "../src/lib/sql/pglite";

const t0 = Date.now();
const db = await PGlite.create();
await db.exec(PLAYGROUND_SEED);
console.log(`playground seed: ${Date.now() - t0} ms`);
for (const t of ["departments","employees","customers","products","orders","order_items","logins"]) {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
  process.stdout.write(`${t}=${r.rows[0].n} `);
}
console.log();
const s = await db.query(`SELECT count(*) FILTER (WHERE customer_id IS NULL) AS guests, min(total), max(total), avg(total)::int FROM orders`);
console.log(s.rows[0]);
const notIn = await db.query(`SELECT count(*) AS n FROM customers WHERE id NOT IN (SELECT customer_id FROM orders)`);
console.log("NOT IN trap rows:", notIn.rows[0]);
for (const ex of SQL_EXERCISES) {
  try {
    const r = await db.query(ex.solution, [], { rowMode: "array" });
    const rows = (r.rows as unknown[][]).map((row) => row.map(formatValue));
    console.log(`\n# ${ex.id}: ${rows.length} rows, cols=${r.fields.map((f) => f.name).join(",")}`);
    for (const row of rows.slice(0, 6)) console.log("  ", row.join(" | "));
  } catch (e) {
    console.log(`\n# ${ex.id}: ERROR ${(e as Error).message}`);
  }
}
const t1 = Date.now();
const db2 = await PGlite.create();
await db2.exec(PLAN_SEED);
console.log(`\nplan seed: ${Date.now() - t1} ms`);
const k = await db2.query(`SELECT city, count(*) FROM customers GROUP BY city ORDER BY 2`);
console.log(k.rows.slice(0, 3));
const plan = await db2.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM orders WHERE customer_id = 4242`);
console.log(typeof (plan.rows[0] as any)["QUERY PLAN"], JSON.stringify((plan.rows[0] as any)["QUERY PLAN"]).slice(0, 400));

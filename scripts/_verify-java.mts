// Compiles every ```java block in the lessons with the local JDK (javac 21+ on
// PATH). Lesson snippets are often fragments, so each block is tried as written,
// as a class body, and as a method body; a block passes if one of those
// compiles with no errors except names the surrounding lesson defines (an
// `Account` class, a `produce()` method). Anything else — syntax errors, wrong
// JDK API names, type errors — fails the run.
// Usage: npx tsx scripts/_verify-java.mts [lesson-id ...]
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const LESSONS = join(import.meta.dirname, "..", "content", "lessons");

// Blocks that are not meant to compile, by lesson and a substring of the block.
const NOT_JAVA: { lesson: string; contains: string; why: string }[] = [
  { lesson: "os-deadlocks", contains: "synchronized (b) { ... }", why: "two threads drawn side by side" },
];
// Blocks that need a library outside the JDK.
const NEEDS_LIBRARY = ["io.netty", "ChannelHandlerContext"];

const IMPORTS = [
  "java.util.*",
  "java.util.concurrent.*",
  "java.util.concurrent.atomic.*",
  "java.util.concurrent.locks.*",
  "java.util.function.*",
  "java.util.stream.*",
  "java.io.*",
  "java.nio.*",
  "java.nio.file.*",
  "java.nio.channels.*",
  "java.nio.charset.*",
  "java.net.*",
  "java.net.http.*",
  "java.lang.management.*",
  "java.lang.invoke.*",
  "java.lang.foreign.*",
  "java.time.*",
  "com.sun.net.httpserver.*",
  "java.security.*",
  "javax.crypto.*",
  "javax.crypto.spec.*",
  "javax.net.ssl.*",
  "java.util.zip.*",
  "java.sql.*",
  "javax.sql.*",
]
  .map((p) => `import ${p};`)
  .join(" ");

interface Block {
  lesson: string;
  line: number;
  code: string;
}

function blocks(only: string[]): Block[] {
  const out: Block[] = [];
  for (const subject of readdirSync(LESSONS)) {
    for (const file of readdirSync(join(LESSONS, subject))) {
      if (!file.endsWith(".md")) continue;
      const lesson = file.slice(0, -3);
      if (only.length && !only.includes(lesson)) continue;
      const lines = readFileSync(join(LESSONS, subject, file), "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== "```java") continue;
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== "```") j++;
        out.push({ lesson, line: i + 1, code: lines.slice(i + 1, j).join("\n") });
        i = j;
      }
    }
  }
  return out;
}

/** The ways to read a fragment: as written, as class members, as statements. */
function attempts(code: string): { file: string; src: string }[] {
  const lines = code.split("\n");
  const imports = lines.filter((l) => l.startsWith("import ")).join("\n");
  const body = lines.filter((l) => !l.startsWith("import ")).join("\n");
  const pre = `${imports}\n${IMPORTS}\n`;
  // `volatile int turn;` is a field, but a local variable can't be volatile
  const asLocals = body.replace(/^(\s*)((?:private|public|protected|static|volatile)\s+)+/gm, "$1");
  const out: { file: string; src: string }[] = [];
  if (/^(public |final |abstract |sealed )*(class|record|interface|enum) \w+/m.test(code)) {
    const pub = code.match(/^public (?:final )?(?:class|record|interface|enum) (\w+)/m);
    out.push({ file: `${pub ? pub[1] : "Snippet"}.java`, src: pre + body });
  }
  out.push(
    { file: "Snippet.java", src: `${pre}class Snippet {\n${body}\n}` },
    { file: "Snippet.java", src: `${pre}class Snippet<T> {\n${body}\n}` },
    { file: "Snippet.java", src: `${pre}class Snippet { void __m() throws Exception {\n${body}\n}}` },
    { file: "Snippet.java", src: `${pre}class Snippet { Object __m() throws Exception {\n${body}\n}}` },
    { file: "Snippet.java", src: `${pre}class Snippet { void __m() throws Exception {\n${asLocals}\n}}` },
  );
  return out;
}

/** javac errors other than "cannot find symbol" for a name the snippet never declared. */
function realErrors(output: string): string[] {
  return output
    .split(/^(?=\S[^\n]*\.java:\d+: error:)/m)
    .filter((e) => e.includes(": error:"))
    .filter((e) => !(e.includes("cannot find symbol") && /location: class Snippet\b/.test(e)))
    .map((e) => {
      const [head, ...rest] = e.split("\n").filter((l) => l.trim() && l.trim() !== "^");
      return `${head.split("error:")[1]?.trim()} | ${rest.slice(0, 2).map((l) => l.trim()).join(" / ")}`;
    });
}

const JAVAC_FLAGS = [
  ...["--source", "21", "--enable-preview", "-Xlint:-preview", "-XDsuppressNotes", "-proc:none"],
  // the cache-contention lesson tells readers to compile its @Contended examples with this
  ...["--add-exports", "java.base/jdk.internal.vm.annotation=ALL-UNNAMED"],
];

/** Compiles one candidate: `clean` if javac succeeded, `real` = errors that aren't missing context names. */
async function javac(dir: string, file: string, src: string): Promise<{ clean: boolean; real: string[] }> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), src);
  try {
    await run("javac", [...JAVAC_FLAGS, "-d", join(dir, "out"), join(dir, file)]);
    return { clean: true, real: [] };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: string };
    if (err.code === "ENOENT") throw new Error("javac not found: install a JDK (21 or later) and put it on PATH.");
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (!out.includes("error:")) return { clean: false, real: [out.trim() || "javac failed"] };
    return { clean: false, real: realErrors(out) };
  }
}

type Result = { b: Block; status: "ok" | "context" | "fail" | "skip"; errors?: string[]; why?: string };

async function check(b: Block, dir: string): Promise<Result> {
  const allow = NOT_JAVA.find((x) => x.lesson === b.lesson && b.code.includes(x.contains));
  if (allow) return { b, status: "skip", why: allow.why };
  if (NEEDS_LIBRARY.some((s) => b.code.includes(s))) return { b, status: "skip", why: "needs a library outside the JDK" };
  let best: string[] | null = null;
  let context = false;
  for (const a of attempts(b.code)) {
    const { clean, real } = await javac(dir, a.file, a.src);
    if (clean) return { b, status: "ok" };
    // only names the lesson defines elsewhere are missing; keep looking for a clean reading
    if (real.length === 0) context = true;
    else if (!best || real.length < best.length) best = real;
  }
  return context ? { b, status: "context" } : { b, status: "fail", errors: best ?? [] };
}

const only = process.argv.slice(2);
const all = blocks(only);
const root = mkdtempSync(join(tmpdir(), "verify-java-"));
const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async (_, w) => {
    while (next < all.length) {
      const b = all[next++];
      results.push(await check(b, join(root, `w${w}`)));
    }
  }),
);
rmSync(root, { recursive: true, force: true });

results.sort((x, y) => (x.b.lesson + x.b.line.toString().padStart(5, "0")).localeCompare(y.b.lesson + y.b.line.toString().padStart(5, "0")));
for (const r of results) {
  if (r.status === "fail") {
    console.log(`FAIL ${r.b.lesson}.md:${r.b.line}`);
    for (const e of r.errors!.slice(0, 4)) console.log(`     ${e}`);
  } else if (r.status === "skip") console.log(`skip ${r.b.lesson}.md:${r.b.line} (${r.why})`);
}
const count = (s: Result["status"]) => results.filter((r) => r.status === s).length;
console.log(
  `\n${results.length} Java blocks: ${count("ok")} compile as written, ${count("context")} compile apart from names the lesson defines, ${count("skip")} skipped, ${count("fail")} failed.`,
);
process.exit(count("fail") ? 1 : 0);

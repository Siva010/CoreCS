// Validates the whole curriculum: frontmatter, section names, question and
// practice formats, prerequisite graph (existence + acyclicity + ordering),
// widget references and every scheme link (lesson:, lab:, viz:, case:, uth:, trap:).
//   npm run validate            → errors + warnings summary
//   npm run validate -- --all   → print every warning too
import {
  getAllLessons,
  getBrokenLinks,
  getCaseStudies,
  getCounts,
  getDiagnostics,
  getWalkthroughs,
  renderCaseStudy,
  renderLesson,
  renderTraps,
  renderWalkthrough,
} from "../src/lib/content/loader";

async function main() {
  const lessons = getAllLessons();
  for (const l of lessons) await renderLesson(l.id);
  for (const c of getCaseStudies()) await renderCaseStudy(c.id);
  for (const w of getWalkthroughs()) await renderWalkthrough(w.id);
  await renderTraps();

  const diags = getDiagnostics();
  const errors = diags.filter((d) => d.level === "error");
  const warns = diags.filter((d) => d.level === "warn");
  const broken = getBrokenLinks();
  const showAll = process.argv.includes("--all");

  console.log("Content counts:", getCounts());
  for (const e of errors) console.log(`ERROR  ${e.file}: ${e.message}`);
  for (const b of broken) console.log(`ERROR  ${b.ctx}: broken link ${b.href}`);
  for (const w of showAll ? warns : warns.slice(0, 25)) console.log(`warn   ${w.file}: ${w.message}`);
  if (!showAll && warns.length > 25) console.log(`… ${warns.length - 25} more warnings (use --all)`);

  const bySubject: Record<string, number> = {};
  for (const l of lessons) bySubject[l.subject] = (bySubject[l.subject] ?? 0) + 1;
  console.log("Lessons by subject:", bySubject);
  const total = errors.length + broken.length;
  console.log(total ? `\n${total} error(s).` : "\nNo errors.");
  process.exit(total ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

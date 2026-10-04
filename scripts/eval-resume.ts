import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractResumeText } from "@/lib/resume/extract";
import { parseResume } from "@/lib/resume/parse";

/** Usage: npm run eval:resume <path-to-resume.pdf|docx> — runs extraction + Claude parsing and prints the result. */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run eval:resume <path-to-resume.pdf|docx>");

  const bytes = await readFile(file);
  const t0 = performance.now();
  const { text } = await extractResumeText(bytes, path.basename(file), "");
  const t1 = performance.now();
  const profile = await parseResume(text);
  const t2 = performance.now();

  console.log(JSON.stringify(profile, null, 2));
  console.error(
    `\nextracted ${text.length} chars in ${Math.round(t1 - t0)} ms; parsed in ${Math.round(t2 - t1)} ms`,
  );
  console.error(
    `${profile.experience.length} roles, ${profile.skills.length} skill groups, ${profile.projects.length} projects, ${profile.education.length} education entries`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

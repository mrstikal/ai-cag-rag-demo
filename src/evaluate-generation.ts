import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "./config";
import { DEFAULT_GEN_FILE, runGenerationEval, type GenReport } from "./generation-eval";

interface ParsedArgs {
  file: string;
  json: boolean;
  out: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  let file = DEFAULT_GEN_FILE;
  let json = false;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") {
      const value = argv[i + 1];
      if (!value) throw new Error("--file requires a path");
      file = path.resolve(ROOT_DIR, value);
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a path");
      out = path.resolve(ROOT_DIR, value);
      i += 1;
    }
  }
  return { file, json, out };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function mark(value: boolean | null): string {
  if (value === null) return "-";
  return value ? "ok" : "MISS";
}

function printReport(report: GenReport): void {
  console.log("RAG generation eval - grounded answers + citations");
  console.log(`File:  ${path.relative(ROOT_DIR, report.file)}`);
  console.log(`Model: ${report.model}`);
  console.log("");
  console.log("id    type   status        src   facts  citations  question");
  for (const outcome of report.outcomes) {
    const type = outcome.answerable ? "ans" : "unans";
    const status = (outcome.status === "error" ? "error" : outcome.status).padEnd(12);
    const citations = outcome.citations.join(",") || "-";
    console.log(
      `${outcome.id}  ${type.padEnd(5)}  ${status} ${mark(outcome.expectedSourceHit).padEnd(5)} ${mark(outcome.factsOk).padEnd(5)}  ${citations.padEnd(9)}  ${truncate(outcome.question, 42)}`,
    );
    if (outcome.error) console.log(`      error: ${outcome.error}`);
  }

  const m = report.metrics;
  console.log("");
  console.log("SUMMARY");
  console.log(`Questions:            ${m.total}`);
  console.log(`Answerable accuracy:  ${m.answerableCorrect}/${m.answerableTotal}`);
  console.log(`Unanswerable accuracy:${m.unanswerableCorrect}/${m.unanswerableTotal}`);
  console.log(`Citation validity:    ${m.citationValid}/${m.total}`);
  console.log(`Expected source hit:  ${m.expectedSourceHit}/${m.answerableTotal}`);
  if (m.errors > 0) console.log(`Errors:               ${m.errors}`);
}

async function main(): Promise<void> {
  const { file, json, out } = parseArgs(process.argv.slice(2));
  const report = await runGenerationEval(file);

  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);

  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(report, null, 2), "utf8");
    if (!json) console.log(`\nWrote ${path.relative(ROOT_DIR, out)}`);
  }
}

main().catch((error) => {
  console.error("");
  console.error("Generation eval failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

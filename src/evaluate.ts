import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { buildReport, DEFAULT_EVAL_FILE, type EvalReport, type QueryOutcome } from "./evaluation";

interface ParsedArgs {
  topK: number;
  file: string;
  json: boolean;
  out: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  let topK = config.search.topK;
  let file = DEFAULT_EVAL_FILE;
  let json = false;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--top" || arg === "-k") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--top requires a positive integer");
      topK = Math.floor(parsed);
      i += 1;
    } else if (arg === "--file") {
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

  return { topK, file, json, out };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0).padStart(3)}%`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function printTable(outcomes: QueryOutcome[]): void {
  console.log("eval  rank  query");
  for (const outcome of outcomes) {
    const rank = outcome.rank === null ? " -" : String(outcome.rank).padStart(2);
    const mark = outcome.rank === null ? "MISS" : "ok";
    console.log(`${outcome.id}  ${rank}   ${mark}  ${truncate(outcome.query, 64)}`);
  }
}

function printReport(report: EvalReport): void {
  const { outcomes, metrics, topK } = report;
  console.log("RAG eval — dense retrieval");
  console.log(`File:     ${path.relative(ROOT_DIR, report.file)}`);
  console.log(`Provider: ${report.provider} / ${report.model}`);
  console.log(`k:        ${topK}`);
  console.log("");
  printTable(outcomes);

  console.log("");
  console.log("SUMMARY");
  console.log(`Queries:      ${metrics.queries}`);
  console.log(`Found in top-${topK}: ${metrics.found}/${metrics.queries}`);
  if (topK >= 1) console.log(`Hit@1:        ${percent(metrics.hitAt1)}`);
  if (topK >= 3) console.log(`Hit@3:        ${percent(metrics.hitAt3)}`);
  if (topK >= 5) console.log(`Hit@5:        ${percent(metrics.hitAt5)}`);
  console.log(`MRR@${topK}:       ${metrics.mrr.toFixed(3)}`);

  const misses = outcomes.filter((outcome) => outcome.rank === null);
  if (misses.length > 0) {
    console.log("");
    console.log(`Misses (${misses.length}):`);
    for (const miss of misses) {
      const got = miss.results.map((result) => result.documentId).join(", ") || "no results";
      console.log(`  ${miss.id}  expected [${miss.expected.join(", ")}], got [${got}]`);
      console.log(`      "${miss.query}"`);
    }
  }
}

async function main(): Promise<void> {
  const { topK, file, json, out } = parseArgs(process.argv.slice(2));
  const report = await buildReport(file, topK);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(report, null, 2), "utf8");
    if (!json) console.log(`\nWrote ${path.relative(ROOT_DIR, out)}`);
  }
}

main().catch((error) => {
  console.error("");
  console.error("Eval failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

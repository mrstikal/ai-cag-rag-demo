import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import {
  buildReport,
  DEFAULT_EVAL_FILE,
  type EvalModeResult,
  type EvalReport,
  type Metrics,
  type QueryOutcome,
} from "./evaluation";

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

function docCell(rank: number | null): string {
  return rank === null ? "-" : String(rank);
}

function chunkCell(outcome: QueryOutcome): string {
  if (outcome.expectedChunk === undefined) return "-";
  return outcome.chunkRank === null ? "X" : String(outcome.chunkRank);
}

function printComparison(dense: QueryOutcome[], metadata: QueryOutcome[]): void {
  console.log("eval   dense    metadata   query");
  console.log("       doc chk  doc chk");
  dense.forEach((outcome, index) => {
    const meta = metadata[index];
    if (!meta) return;
    const denseCols = `${docCell(outcome.rank).padStart(3)} ${chunkCell(outcome).padStart(3)}`;
    const metaCols = `${docCell(meta.rank).padStart(3)} ${chunkCell(meta).padStart(3)}`;
    console.log(`${outcome.id}  ${denseCols}  ${metaCols}   ${truncate(outcome.query, 46)}`);
  });
}

function printModeSummary(label: string, metrics: Metrics, topK: number): void {
  console.log("");
  console.log(`${label}`);
  console.log(`  Document found:   ${metrics.found}/${metrics.queries}`);
  if (topK >= 1) console.log(`  Document Hit@1:   ${percent(metrics.hitAt1)}`);
  if (topK >= 3) console.log(`  Document Hit@3:   ${percent(metrics.hitAt3)}`);
  if (topK >= 5) console.log(`  Document Hit@5:   ${percent(metrics.hitAt5)}`);
  console.log(`  Document MRR@${topK}: ${metrics.mrr.toFixed(3)}`);
  if (metrics.chunkQueries > 0) {
    console.log(`  Chunk found:      ${metrics.chunkFound}/${metrics.chunkQueries}`);
    if (topK >= 1) console.log(`  Chunk Hit@1:      ${percent(metrics.chunkHitAt1)}`);
    if (topK >= 3) console.log(`  Chunk Hit@3:      ${percent(metrics.chunkHitAt3)}`);
    if (topK >= 5) console.log(`  Chunk Hit@5:      ${percent(metrics.chunkHitAt5)}`);
    console.log(`  Chunk MRR@${topK}:    ${metrics.chunkMrr.toFixed(3)}`);
  }
}

function printMisses(label: string, outcomes: QueryOutcome[]): void {
  const docMisses = outcomes.filter((outcome) => outcome.rank === null);
  const chunkMisses = outcomes.filter(
    (outcome) => outcome.expectedChunk !== undefined && outcome.chunkRank === null,
  );
  if (docMisses.length === 0 && chunkMisses.length === 0) return;

  console.log("");
  console.log(`${label} misses:`);
  for (const miss of docMisses) {
    const got = miss.results.map((result) => result.documentId).join(", ") || "no results";
    console.log(`  doc   ${miss.id}  expected [${miss.expected.join(", ")}], got [${got}]`);
  }
  for (const miss of chunkMisses) {
    const got = miss.results[0];
    const gotText = got ? `${got.documentId} chunk ${got.chunkIndex}` : "no results";
    console.log(
      `  chunk ${miss.id}  expected [${miss.expected.join(", ")} chunk ${miss.expectedChunk}], top hit ${gotText}`,
    );
  }
}

function printReport(report: EvalReport): void {
  console.log("RAG eval — dense vs dense + metadata");
  console.log(`File:     ${path.relative(ROOT_DIR, report.file)}`);
  console.log(`Provider: ${report.provider} / ${report.model}`);
  console.log(`k:        ${report.topK}`);
  console.log("");
  printComparison(report.dense.outcomes, report.metadata.outcomes);
  printModeSummary("DENSE (no filters)", report.dense.metrics, report.topK);
  printModeSummary("DENSE + METADATA", report.metadata.metrics, report.topK);
  printMisses("Dense", report.dense.outcomes);
  printMisses("Dense + metadata", report.metadata.outcomes);
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

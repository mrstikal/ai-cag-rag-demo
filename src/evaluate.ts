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
  candidateDepth: number;
  file: string;
  json: boolean;
  out: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  let topK = config.search.topK;
  let candidateDepth = config.eval.candidateDepth;
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
    } else if (arg === "--candidates" || arg === "-c") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--candidates requires a positive integer");
      candidateDepth = Math.floor(parsed);
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

  return { topK, candidateDepth, file, json, out };
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

function modeColumns(report: EvalReport): { label: string; mode: EvalModeResult }[] {
  return [
    { label: "Dense", mode: report.modes.dense },
    { label: "Dense+meta", mode: report.modes.denseMetadata },
    { label: "BM25", mode: report.modes.bm25 },
    { label: "BM25+meta", mode: report.modes.bm25Metadata },
    { label: "Hybrid", mode: report.modes.hybrid },
    { label: "Hybrid+meta", mode: report.modes.hybridMetadata },
    { label: "Rerank", mode: report.modes.rerank },
    { label: "Rerank+meta", mode: report.modes.rerankMetadata },
  ];
}

function printRankTable(report: EvalReport, cellFor: (mode: EvalModeResult, index: number) => string): void {
  const width = 12;
  const columns = modeColumns(report);
  const header = ["id", ...columns.map((column) => column.label), "query"];
  console.log(header.map((value) => value.padEnd(width)).join(""));
  report.modes.dense.outcomes.forEach((outcome, index) => {
    const cells = columns.map((column) => cellFor(column.mode, index).padEnd(width));
    console.log([outcome.id.padEnd(width), ...cells, truncate(outcome.query, 44)].join(""));
  });
}

function printDocTable(report: EvalReport): void {
  printRankTable(report, (mode, index) => docCell(mode.outcomes[index]?.rank ?? null));
}

function printChunkTable(report: EvalReport): void {
  printRankTable(report, (mode, index) => {
    const outcome = mode.outcomes[index];
    return outcome ? chunkCell(outcome) : "-";
  });
}

function printModeSummary(label: string, metrics: Metrics, topK: number): void {
  console.log("");
  console.log(`${label}`);
  console.log(`  Document found:   ${metrics.found}/${metrics.queries}`);
  console.log(`  Document Hit@1:   ${percent(metrics.hitAt1)}`);
  console.log(`  Document Hit@3:   ${percent(metrics.hitAt3)}`);
  console.log(`  Document Hit@5:   ${percent(metrics.hitAt5)}`);
  console.log(`  Document MRR@${topK}: ${metrics.mrr.toFixed(3)}`);
  console.log(`  Document R@10:    ${percent(metrics.recallAt10)}   R@20: ${percent(metrics.recallAt20)}`);
  if (metrics.chunkQueries > 0) {
    console.log(`  Chunk found:      ${metrics.chunkFound}/${metrics.chunkQueries}`);
    console.log(`  Chunk Hit@1:      ${percent(metrics.chunkHitAt1)}`);
    console.log(`  Chunk Hit@3:      ${percent(metrics.chunkHitAt3)}`);
    console.log(`  Chunk Hit@5:      ${percent(metrics.chunkHitAt5)}`);
    console.log(`  Chunk MRR@${topK}:    ${metrics.chunkMrr.toFixed(3)}`);
    console.log(`  Chunk R@10:       ${percent(metrics.chunkRecallAt10)}   R@20: ${percent(metrics.chunkRecallAt20)}`);
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
    const shown = miss.results.slice(0, 5).map((result) => result.documentId);
    const suffix = miss.results.length > 5 ? ", …" : "";
    const got = shown.join(", ") + suffix || "no results";
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
  console.log("RAG eval — dense, BM25, hybrid RRF (± metadata)");
  console.log(`File:       ${path.relative(ROOT_DIR, report.file)}`);
  console.log(`Provider:   ${report.provider} / ${report.model}`);
  console.log(`final k:    ${report.topK}`);
  console.log(`candidates: ${report.candidateDepth} (rank tables show rank within the candidate pool)`);
  console.log(`reranker:   ${report.reranker.provider} / ${report.reranker.model}`);

  console.log("");
  console.log("DOCUMENT rank (rank of expected document, '-' = miss)");
  printDocTable(report);

  console.log("");
  console.log("CHUNK rank (rank of expected chunk, 'X' = miss, '-' = no expectation)");
  printChunkTable(report);

  printModeSummary("DENSE", report.modes.dense.metrics, report.topK);
  printModeSummary("DENSE + METADATA", report.modes.denseMetadata.metrics, report.topK);
  printModeSummary("BM25", report.modes.bm25.metrics, report.topK);
  printModeSummary("BM25 + METADATA", report.modes.bm25Metadata.metrics, report.topK);
  printModeSummary("HYBRID (RRF 1:1)", report.modes.hybrid.metrics, report.topK);
  printModeSummary("HYBRID + METADATA", report.modes.hybridMetadata.metrics, report.topK);
  printModeSummary("RERANK (dense ∪ bm25 -> cross-encoder)", report.modes.rerank.metrics, report.topK);
  printModeSummary("RERANK + METADATA", report.modes.rerankMetadata.metrics, report.topK);

  printMisses("Dense", report.modes.dense.outcomes);
  printMisses("Dense + metadata", report.modes.denseMetadata.outcomes);
  printMisses("BM25", report.modes.bm25.outcomes);
  printMisses("BM25 + metadata", report.modes.bm25Metadata.outcomes);
  printMisses("Hybrid", report.modes.hybrid.outcomes);
  printMisses("Hybrid + metadata", report.modes.hybridMetadata.outcomes);
  printMisses("Rerank", report.modes.rerank.outcomes);
  printMisses("Rerank + metadata", report.modes.rerankMetadata.outcomes);
}

async function main(): Promise<void> {
  const { topK, candidateDepth, file, json, out } = parseArgs(process.argv.slice(2));
  const report = await buildReport(file, topK, candidateDepth);

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

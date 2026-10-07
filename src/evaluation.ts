import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { getEmbedder } from "./embeddings";
import { semanticSearch } from "./retrieval";

export interface EvalQuery {
  id: string;
  query: string;
  expected: string[];
  note?: string;
}

export interface EvalFile {
  description?: string;
  queries: EvalQuery[];
}

export interface QueryOutcome {
  id: string;
  query: string;
  expected: string[];
  note?: string;
  rank: number | null;
  results: { documentId: string; score: number; chunkIndex: number }[];
}

export interface Metrics {
  queries: number;
  found: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
}

export interface EvalReport {
  file: string;
  provider: string;
  model: string;
  dimensions: number;
  topK: number;
  generatedAt: string;
  metrics: Metrics;
  outcomes: QueryOutcome[];
}

export const DEFAULT_EVAL_FILE = path.join(ROOT_DIR, "eval", "queries.json");

export async function loadEvalQueries(file: string = DEFAULT_EVAL_FILE): Promise<EvalQuery[]> {
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw) as EvalFile;
  if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) {
    throw new Error(`No queries found in ${file}`);
  }
  return parsed.queries;
}

export async function runEvaluation(
  queries: EvalQuery[],
  topK: number = config.search.topK,
): Promise<QueryOutcome[]> {
  const outcomes: QueryOutcome[] = [];
  for (const item of queries) {
    const hits = await semanticSearch(item.query, topK);
    const index = hits.findIndex((hit) => item.expected.includes(hit.documentId));
    outcomes.push({
      id: item.id,
      query: item.query,
      expected: item.expected,
      note: item.note,
      rank: index === -1 ? null : index + 1,
      results: hits.map((hit) => ({
        documentId: hit.documentId,
        score: hit.score,
        chunkIndex: hit.chunkIndex,
      })),
    });
  }
  return outcomes;
}

export function computeMetrics(outcomes: QueryOutcome[], topK: number): Metrics {
  const queries = outcomes.length;
  const ranks = outcomes.map((outcome) => outcome.rank);
  const hitAt = (threshold: number): number =>
    topK < threshold ? 0 : ranks.filter((rank) => rank !== null && rank <= threshold).length / queries;

  let reciprocalRankSum = 0;
  for (const rank of ranks) {
    if (rank !== null) reciprocalRankSum += 1 / rank;
  }

  return {
    queries,
    found: ranks.filter((rank) => rank !== null).length,
    hitAt1: hitAt(1),
    hitAt3: hitAt(3),
    hitAt5: hitAt(5),
    mrr: reciprocalRankSum / queries,
  };
}

export async function buildReport(
  file: string = DEFAULT_EVAL_FILE,
  topK: number = config.search.topK,
): Promise<EvalReport> {
  const embedder = getEmbedder();
  const queries = await loadEvalQueries(file);
  const outcomes = await runEvaluation(queries, topK);

  return {
    file,
    provider: embedder.provider,
    model: embedder.model,
    dimensions: embedder.dimensions,
    topK,
    generatedAt: new Date().toISOString(),
    metrics: computeMetrics(outcomes, topK),
    outcomes,
  };
}

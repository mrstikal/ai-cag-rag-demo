import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { getEmbedder } from "./embeddings";
import { semanticSearch, type SearchFilters } from "./retrieval";

export interface EvalQuery {
  id: string;
  query: string;
  expected: string[];
  expectedChunk?: number;
  filters?: SearchFilters;
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
  expectedChunk?: number;
  filters?: SearchFilters;
  note?: string;
  rank: number | null;
  chunkRank: number | null;
  results: { documentId: string; score: number; chunkIndex: number }[];
}

export interface Metrics {
  queries: number;
  found: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
  chunkQueries: number;
  chunkFound: number;
  chunkHitAt1: number;
  chunkHitAt3: number;
  chunkHitAt5: number;
  chunkMrr: number;
}

export interface EvalModeResult {
  applyFilters: boolean;
  metrics: Metrics;
  outcomes: QueryOutcome[];
}

export interface EvalReport {
  file: string;
  provider: string;
  model: string;
  dimensions: number;
  topK: number;
  generatedAt: string;
  dense: EvalModeResult;
  metadata: EvalModeResult;
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
  applyFilters = false,
): Promise<QueryOutcome[]> {
  const outcomes: QueryOutcome[] = [];
  for (const item of queries) {
    const hits = await semanticSearch({
      query: item.query,
      limit: topK,
      filters: applyFilters ? item.filters : undefined,
    });
    const index = hits.findIndex((hit) => item.expected.includes(hit.documentId));
    let chunkRank: number | null = null;
    if (typeof item.expectedChunk === "number") {
      const chunkIndex = hits.findIndex(
        (hit) => item.expected.includes(hit.documentId) && hit.chunkIndex === item.expectedChunk,
      );
      chunkRank = chunkIndex === -1 ? null : chunkIndex + 1;
    }
    outcomes.push({
      id: item.id,
      query: item.query,
      expected: item.expected,
      expectedChunk: item.expectedChunk,
      filters: item.filters,
      note: item.note,
      rank: index === -1 ? null : index + 1,
      chunkRank,
      results: hits.map((hit) => ({
        documentId: hit.documentId,
        score: hit.score,
        chunkIndex: hit.chunkIndex,
      })),
    });
  }
  return outcomes;
}

interface RankMetrics {
  queries: number;
  found: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
}

function metricsFromRanks(ranks: (number | null)[], topK: number): RankMetrics {
  const queries = ranks.length;
  if (queries === 0) {
    return { queries: 0, found: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0 };
  }
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

export function computeMetrics(outcomes: QueryOutcome[], topK: number): Metrics {
  const documents = metricsFromRanks(
    outcomes.map((outcome) => outcome.rank),
    topK,
  );
  // Chunk metrics only cover queries that declare an expectedChunk.
  const chunkSubset = outcomes.filter((outcome) => typeof outcome.expectedChunk === "number");
  const chunks = metricsFromRanks(
    chunkSubset.map((outcome) => outcome.chunkRank),
    topK,
  );

  return {
    queries: documents.queries,
    found: documents.found,
    hitAt1: documents.hitAt1,
    hitAt3: documents.hitAt3,
    hitAt5: documents.hitAt5,
    mrr: documents.mrr,
    chunkQueries: chunks.queries,
    chunkFound: chunks.found,
    chunkHitAt1: chunks.hitAt1,
    chunkHitAt3: chunks.hitAt3,
    chunkHitAt5: chunks.hitAt5,
    chunkMrr: chunks.mrr,
  };
}

export async function buildReport(
  file: string = DEFAULT_EVAL_FILE,
  topK: number = config.search.topK,
): Promise<EvalReport> {
  const embedder = getEmbedder();
  const queries = await loadEvalQueries(file);

  const denseOutcomes = await runEvaluation(queries, topK, false);
  const metadataOutcomes = await runEvaluation(queries, topK, true);

  return {
    file,
    provider: embedder.provider,
    model: embedder.model,
    dimensions: embedder.dimensions,
    topK,
    generatedAt: new Date().toISOString(),
    dense: {
      applyFilters: false,
      metrics: computeMetrics(denseOutcomes, topK),
      outcomes: denseOutcomes,
    },
    metadata: {
      applyFilters: true,
      metrics: computeMetrics(metadataOutcomes, topK),
      outcomes: metadataOutcomes,
    },
  };
}

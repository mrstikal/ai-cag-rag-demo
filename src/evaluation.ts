import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { getEmbedder } from "./embeddings";
import { search, type Retriever, type SearchFilters } from "./retrieval";
import { rerankerInfo, type RerankerInfo } from "./reranker";

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
  recallAt10: number;
  recallAt20: number;
  chunkQueries: number;
  chunkFound: number;
  chunkHitAt1: number;
  chunkHitAt3: number;
  chunkHitAt5: number;
  chunkMrr: number;
  chunkRecallAt10: number;
  chunkRecallAt20: number;
}

export interface EvalModeResult {
  retriever: Retriever;
  applyFilters: boolean;
  metrics: Metrics;
  outcomes: QueryOutcome[];
}

export interface EvalModes {
  dense: EvalModeResult;
  denseMetadata: EvalModeResult;
  bm25: EvalModeResult;
  bm25Metadata: EvalModeResult;
  hybrid: EvalModeResult;
  hybridMetadata: EvalModeResult;
  rerank: EvalModeResult;
  rerankMetadata: EvalModeResult;
}

export interface EvalReport {
  file: string;
  provider: string;
  model: string;
  dimensions: number;
  reranker: RerankerInfo;
  topK: number;
  candidateDepth: number;
  generatedAt: string;
  modes: EvalModes;
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
  depth: number = config.eval.candidateDepth,
  retriever: Retriever = "dense",
  applyFilters = false,
): Promise<QueryOutcome[]> {
  const outcomes: QueryOutcome[] = [];
  for (const item of queries) {
    const hits = await search({
      query: item.query,
      limit: depth,
      retriever,
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
  recallAt10: number;
  recallAt20: number;
}

function metricsFromRanks(ranks: (number | null)[], k: number, depth: number): RankMetrics {
  const queries = ranks.length;
  if (queries === 0) {
    return { queries: 0, found: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0, recallAt10: 0, recallAt20: 0 };
  }
  const hitAt = (threshold: number): number =>
    ranks.filter((rank) => rank !== null && rank <= threshold).length / queries;

  let reciprocalRankSum = 0;
  for (const rank of ranks) {
    // MRR uses the final cutoff k, not the deeper candidate pool.
    if (rank !== null && rank <= k) reciprocalRankSum += 1 / rank;
  }

  return {
    queries,
    found: ranks.filter((rank) => rank !== null).length,
    hitAt1: hitAt(1),
    hitAt3: hitAt(3),
    hitAt5: hitAt(5),
    mrr: reciprocalRankSum / queries,
    recallAt10: depth >= 10 ? hitAt(10) : 0,
    recallAt20: depth >= 20 ? hitAt(20) : 0,
  };
}

export function computeMetrics(outcomes: QueryOutcome[], k: number, depth: number): Metrics {
  const documents = metricsFromRanks(
    outcomes.map((outcome) => outcome.rank),
    k,
    depth,
  );
  // Chunk metrics only cover queries that declare an expectedChunk.
  const chunkSubset = outcomes.filter((outcome) => typeof outcome.expectedChunk === "number");
  const chunks = metricsFromRanks(
    chunkSubset.map((outcome) => outcome.chunkRank),
    k,
    depth,
  );

  return {
    queries: documents.queries,
    found: documents.found,
    hitAt1: documents.hitAt1,
    hitAt3: documents.hitAt3,
    hitAt5: documents.hitAt5,
    mrr: documents.mrr,
    recallAt10: documents.recallAt10,
    recallAt20: documents.recallAt20,
    chunkQueries: chunks.queries,
    chunkFound: chunks.found,
    chunkHitAt1: chunks.hitAt1,
    chunkHitAt3: chunks.hitAt3,
    chunkHitAt5: chunks.hitAt5,
    chunkMrr: chunks.mrr,
    chunkRecallAt10: chunks.recallAt10,
    chunkRecallAt20: chunks.recallAt20,
  };
}

export async function buildReport(
  file: string = DEFAULT_EVAL_FILE,
  k: number = config.search.topK,
  depth: number = config.eval.candidateDepth,
): Promise<EvalReport> {
  const embedder = getEmbedder();
  const queries = await loadEvalQueries(file);

  const run = async (retriever: Retriever, applyFilters: boolean): Promise<EvalModeResult> => {
    const outcomes = await runEvaluation(queries, depth, retriever, applyFilters);
    return {
      retriever,
      applyFilters,
      metrics: computeMetrics(outcomes, k, depth),
      outcomes,
    };
  };

  return {
    file,
    provider: embedder.provider,
    model: embedder.model,
    dimensions: embedder.dimensions,
    reranker: rerankerInfo(),
    topK: k,
    candidateDepth: depth,
    generatedAt: new Date().toISOString(),
    modes: {
      dense: await run("dense", false),
      denseMetadata: await run("dense", true),
      bm25: await run("bm25", false),
      bm25Metadata: await run("bm25", true),
      hybrid: await run("hybrid", false),
      hybridMetadata: await run("hybrid", true),
      rerank: await run("rerank", false),
      rerankMetadata: await run("rerank", true),
    },
  };
}

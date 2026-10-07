import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import { config } from "./config";
import { embedText } from "./embeddings";
import {
  bm25SearchPoints,
  createClient,
  denseSearchPoints,
  hybridSearchPoints,
  type SearchHit,
} from "./qdrant";
import { rerankDocuments } from "./reranker";

export type Retriever = "dense" | "bm25" | "hybrid" | "rerank";

export interface SearchFilters {
  status?: string;
  locale?: string;
  category?: string;
  /** Return only documents valid at this instant (valid_from <= asOf AND (valid_to >= asOf OR no valid_to)). */
  asOf?: string;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  filters?: SearchFilters;
  retriever?: Retriever;
}

export interface SearchResult {
  id: string | number;
  score: number;
  documentId: string;
  title: string;
  chunkIndex: number;
  category: string | null;
  locale: string | null;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  sourceFile: string;
  text: string;
  /** rerank retriever only */
  rerankScore?: number;
  denseRank?: number;
  bm25Rank?: number;
}

let client: QdrantClient | undefined;

function qdrant(): QdrantClient {
  return (client ??= createClient());
}

/**
 * A metadata filter is NOT part of the similarity computation. It restricts
 * the candidate set; ranking inside that set is done by the retriever. `must`
 * = AND, `should` = OR, `is_empty` matches a missing field, null, or an empty
 * array. The filter is orthogonal to the retriever.
 */
export function buildFilter(filters?: SearchFilters): Schemas["Filter"] | undefined {
  if (!filters) return undefined;

  const must: Record<string, unknown>[] = [];

  if (filters.status) {
    must.push({ key: "status", match: { value: filters.status } });
  }
  if (filters.locale) {
    must.push({ key: "locale", match: { value: filters.locale } });
  }
  if (filters.category) {
    must.push({ key: "category", match: { value: filters.category } });
  }
  if (filters.asOf) {
    must.push({ key: "valid_from", range: { lte: filters.asOf } });
    must.push({
      should: [
        { key: "valid_to", range: { gte: filters.asOf } },
        { is_empty: { key: "valid_to" } },
      ],
    });
  }

  return must.length > 0 ? ({ must } as Schemas["Filter"]) : undefined;
}

function mapHit(hit: SearchHit, extras: Partial<SearchResult> = {}): SearchResult {
  return {
    id: hit.id,
    score: hit.score,
    documentId: hit.payload.document_id,
    title: hit.payload.title,
    chunkIndex: hit.payload.chunk_index,
    category: hit.payload.category,
    locale: hit.payload.locale,
    status: hit.payload.status,
    validFrom: hit.payload.valid_from,
    validTo: hit.payload.valid_to,
    sourceFile: hit.payload.source_file,
    text: hit.payload.text,
    ...extras,
  };
}

/**
 * Two-stage retrieval: candidate stage = dense top-N ∪ BM25 top-N (deduped by
 * point id), then a cross-encoder reranker scores query+chunk together and
 * produces the final order. We deliberately do NOT fuse with RRF first, since
 * RRF can drop a good candidate (e.g. q19) before the reranker ever sees it.
 */
async function rerankSearch(
  query: string,
  limit: number,
  filter: Schemas["Filter"] | undefined,
): Promise<SearchResult[]> {
  const [denseHits, bm25Hits] = await Promise.all([
    embedText(query).then((vector) =>
      denseSearchPoints(qdrant(), config.qdrant.collection, vector, config.reranker.candidates, filter),
    ),
    bm25SearchPoints(qdrant(), config.qdrant.collection, query, config.reranker.candidates, filter),
  ]);

  const denseRank = new Map<string, number>();
  const bm25Rank = new Map<string, number>();
  const merged = new Map<string, SearchHit>();

  denseHits.forEach((hit, index) => {
    const key = String(hit.id);
    denseRank.set(key, index + 1);
    if (!merged.has(key)) merged.set(key, hit);
  });
  bm25Hits.forEach((hit, index) => {
    const key = String(hit.id);
    bm25Rank.set(key, index + 1);
    if (!merged.has(key)) merged.set(key, hit);
  });

  const candidates = [...merged.values()];
  const scores = await rerankDocuments(
    query,
    candidates.map((candidate) => candidate.payload.text),
  );

  const seen = new Set<number>();
  const results: SearchResult[] = [];
  const extrasFor = (index: number): Partial<SearchResult> => {
    const hit = candidates[index];
    return hit
      ? { denseRank: denseRank.get(String(hit.id)), bm25Rank: bm25Rank.get(String(hit.id)) }
      : {};
  };

  for (const scored of scores) {
    if (scored.index < 0 || scored.index >= candidates.length || seen.has(scored.index)) continue;
    seen.add(scored.index);
    const hit = candidates[scored.index];
    if (!hit) continue;
    results.push(mapHit(hit, { ...extrasFor(scored.index), score: scored.score, rerankScore: scored.score }));
    if (results.length >= limit) break;
  }

  // Append any candidates the scorer did not return (partial responses).
  for (let index = 0; index < candidates.length && results.length < limit; index++) {
    if (seen.has(index)) continue;
    seen.add(index);
    const hit = candidates[index];
    if (hit) results.push(mapHit(hit, extrasFor(index)));
  }

  return results;
}

/**
 * Retrieval entry point. `retriever` selects the mechanism:
 * - "dense":  OpenAI query embedding + cosine over the `dense` vector
 * - "bm25":   server-side BM25 sparse retrieval over the `bm25` vector
 * - "hybrid": dense + BM25 prefetched separately, fused with RRF (1:1)
 * - "rerank": dense ∪ BM25 candidates, reordered by a cross-encoder
 * A metadata filter restricts the candidate set for every retriever and is
 * applied before fusion/reranking.
 */
export async function search(options: SearchOptions): Promise<SearchResult[]> {
  const query = options.query.trim();
  if (query === "") return [];

  const limit = options.limit ?? config.search.topK;
  const filter = buildFilter(options.filters);
  const retriever = options.retriever ?? "dense";

  if (retriever === "rerank") {
    return rerankSearch(query, limit, filter);
  }

  if (retriever === "bm25") {
    const hits = await bm25SearchPoints(qdrant(), config.qdrant.collection, query, limit, filter);
    return hits.map((hit) => mapHit(hit));
  }

  const vector = await embedText(query);
  const hits =
    retriever === "hybrid"
      ? await hybridSearchPoints(
          qdrant(),
          config.qdrant.collection,
          vector,
          query,
          limit,
          filter,
          config.search.prefetchLimit,
        )
      : await denseSearchPoints(qdrant(), config.qdrant.collection, vector, limit, filter);

  return hits.map((hit) => mapHit(hit));
}

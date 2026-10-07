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

export type Retriever = "dense" | "bm25" | "hybrid";

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
}

let client: QdrantClient | undefined;

function qdrant(): QdrantClient {
  return (client ??= createClient());
}

/**
 * A metadata filter is NOT part of the similarity computation. It restricts
 * the candidate set; ranking inside that set is still done by the retriever.
 * `must` = AND, `should` = OR, `is_empty` matches a missing field, null, or an
 * empty array. The filter is orthogonal to the retriever and applies to both
 * dense and BM25.
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

/**
 * Retrieval entry point. `retriever` selects the mechanism:
 * - "dense":  OpenAI query embedding + cosine over the `dense` vector
 * - "bm25":   server-side BM25 sparse retrieval over the `bm25` vector
 * - "hybrid": dense + BM25 prefetched separately, fused with RRF (1:1)
 * A metadata filter restricts the candidate set for every retriever.
 */
export async function search(options: SearchOptions): Promise<SearchResult[]> {
  const query = options.query.trim();
  if (query === "") return [];

  const limit = options.limit ?? config.search.topK;
  const filter = buildFilter(options.filters);
  const retriever = options.retriever ?? "dense";

  let hits: SearchHit[];
  if (retriever === "bm25") {
    hits = await bm25SearchPoints(qdrant(), config.qdrant.collection, query, limit, filter);
  } else {
    const vector = await embedText(query);
    hits =
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
  }

  return hits.map((hit) => ({
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
  }));
}

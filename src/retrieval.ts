import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import { config } from "./config";
import { embedText } from "./embeddings";
import { createClient, searchPoints } from "./qdrant";

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
 * the candidate set; ranking inside that set is still done by the vector
 * similarity. `must` = AND, `should` = OR, `is_empty` matches a missing field,
 * null, or an empty array.
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
 * Dense retrieval: embed the query with the same model used for documents,
 * return the nearest chunks by cosine similarity, optionally restricted by a
 * metadata filter.
 */
export async function semanticSearch(options: SearchOptions): Promise<SearchResult[]> {
  const query = options.query.trim();
  if (query === "") return [];

  const vector = await embedText(query);
  const hits = await searchPoints(
    qdrant(),
    config.qdrant.collection,
    vector,
    options.limit ?? config.search.topK,
    buildFilter(options.filters),
  );

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

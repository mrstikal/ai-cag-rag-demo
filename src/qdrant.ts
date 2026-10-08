import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";
import { config } from "./config";

export interface ChunkPayload {
  document_id: string;
  document_version: string;
  chunk_index: number;
  title: string;
  category: string | null;
  locale: string | null;
  status: string;
  valid_from: string | null;
  valid_to: string | null;
  tags: string[];
  source_file: string;
  source_uri: string;
  updated_at: string;
  text: string;
}

export interface Bm25Inference {
  text: string;
  model: string;
}

/** Named dense vector plus a server-side BM25 sparse vector. */
export interface PointVector {
  dense: number[];
  bm25: Bm25Inference;
}

export interface Point {
  id: string;
  vector: PointVector;
  payload: ChunkPayload;
}

export interface SearchHit {
  id: string | number;
  score: number;
  payload: ChunkPayload;
}

export const DENSE_VECTOR = "dense";
export const BM25_VECTOR = "bm25";
export const BM25_MODEL = "qdrant/bm25";

export function createClient(): QdrantClient {
  return new QdrantClient({ url: config.qdrant.url });
}

export async function collectionExists(client: QdrantClient, name: string): Promise<boolean> {
  const { collections } = await client.getCollections();
  return collections.some((collection) => collection.name === name);
}

export async function getCollectionVectorSize(
  client: QdrantClient,
  name: string,
): Promise<number | undefined> {
  const info = await client.getCollection(name);
  const vectors = info.config?.params?.vectors;
  if (!vectors) return undefined;
  if (typeof vectors === "object" && "size" in vectors && typeof vectors.size === "number") {
    return vectors.size;
  }
  const named = vectors as Record<string, { size?: number }>;
  const preferred = named[DENSE_VECTOR] ?? Object.values(named)[0];
  return preferred && typeof preferred.size === "number" ? preferred.size : undefined;
}

export async function createCollection(
  client: QdrantClient,
  name: string,
  dimensions: number,
): Promise<void> {
  await client.createCollection(name, {
    vectors: {
      [DENSE_VECTOR]: { size: dimensions, distance: "Cosine" },
    },
    sparse_vectors: {
      [BM25_VECTOR]: { modifier: "idf" },
    },
  });
}

/**
 * Payload indexes for the fields we filter on. Qdrant recommends indexing
 * filtered fields so the query planner can prune the candidate set before
 * running the vector comparison.
 */
const PAYLOAD_INDEXES: { field: string; schema: "keyword" | "datetime" }[] = [
  { field: "status", schema: "keyword" },
  { field: "locale", schema: "keyword" },
  { field: "category", schema: "keyword" },
  { field: "document_id", schema: "keyword" },
  { field: "valid_from", schema: "datetime" },
  { field: "valid_to", schema: "datetime" },
];

export async function createPayloadIndexes(client: QdrantClient, name: string): Promise<void> {
  for (const index of PAYLOAD_INDEXES) {
    await client.createPayloadIndex(name, {
      field_name: index.field,
      field_schema: index.schema,
      wait: true,
    });
  }
}

export async function recreateCollection(
  client: QdrantClient,
  name: string,
  dimensions: number,
): Promise<void> {
  if (await collectionExists(client, name)) {
    await client.deleteCollection(name);
  }
  await createCollection(client, name, dimensions);
}

export async function upsertPoints(
  client: QdrantClient,
  name: string,
  points: Point[],
): Promise<void> {
  const batchSize = 128;
  for (let start = 0; start < points.length; start += batchSize) {
    const batch = points.slice(start, start + batchSize).map((point) => ({
      id: point.id,
      vector: point.vector as unknown as Schemas["VectorStruct"],
      payload: point.payload as unknown as Record<string, unknown>,
    }));
    // Upsert overwrites points with the same id; seed purges stale ones first.
    await client.upsert(name, { wait: true, points: batch });
  }
}

function toHits(points: { id: string | number; score: number; payload?: unknown }[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const point of points) {
    const payload = point.payload as unknown as ChunkPayload | null | undefined;
    // Skip malformed points rather than crashing on an unchecked cast.
    if (!payload || typeof payload.document_id !== "string") continue;
    hits.push({ id: point.id, score: point.score, payload });
  }
  return hits;
}

/** Dense cosine search over the named `dense` vector. */
export async function denseSearchPoints(
  client: QdrantClient,
  name: string,
  vector: number[],
  limit: number,
  filter?: Schemas["Filter"],
): Promise<SearchHit[]> {
  const response = await client.query(name, {
    query: vector,
    using: DENSE_VECTOR,
    limit,
    with_payload: true,
    filter,
  });
  return toHits(response.points);
}

/** BM25 sparse search: Qdrant tokenizes and scores the query server-side. */
export async function bm25SearchPoints(
  client: QdrantClient,
  name: string,
  queryText: string,
  limit: number,
  filter?: Schemas["Filter"],
): Promise<SearchHit[]> {
  const response = await client.query(name, {
    query: { text: queryText, model: BM25_MODEL },
    using: BM25_VECTOR,
    limit,
    with_payload: true,
    filter,
  });
  return toHits(response.points);
}

/**
 * Hybrid retrieval: prefetch from dense and BM25 independently, then fuse the
 * two rankings with Reciprocal Rank Fusion (RRF). RRF uses ranks, not raw
 * scores, so the incomparable cosine and BM25 score scales never mix.
 * `prefetchLimit` is the candidate pool per branch (must be >= the final limit).
 */
export async function hybridSearchPoints(
  client: QdrantClient,
  name: string,
  denseVector: number[],
  queryText: string,
  limit: number,
  filter?: Schemas["Filter"],
  prefetchLimit = 20,
): Promise<SearchHit[]> {
  // Qdrant requires prefetch limit >= final limit.
  const pool = Math.max(prefetchLimit, limit);
  const response = await client.query(name, {
    prefetch: [
      {
        query: denseVector,
        using: DENSE_VECTOR,
        limit: pool,
        ...(filter ? { filter } : {}),
      },
      {
        query: { text: queryText, model: BM25_MODEL },
        using: BM25_VECTOR,
        limit: pool,
        ...(filter ? { filter } : {}),
      },
    ],
    // 1:1 Dense : BM25. Weighted RRF is a later, data-driven decision.
    query: { rrf: {} },
    limit,
    with_payload: true,
  });
  return toHits(response.points);
}

export async function countPoints(client: QdrantClient, name: string): Promise<number> {
  const result = await client.count(name, { exact: true });
  return result.count;
}

/** Distinct document_id values currently indexed (used to purge stale points). */
export async function listDocumentIds(client: QdrantClient, name: string): Promise<string[]> {
  const ids = new Set<string>();
  let offset: string | number | undefined;
  for (;;) {
    const page = await client.scroll(name, {
      limit: 512,
      with_payload: ["document_id"],
      with_vector: false,
      offset,
    });
    for (const point of page.points) {
      const documentId = (point.payload as { document_id?: unknown } | null)?.document_id;
      if (typeof documentId === "string") ids.add(documentId);
    }
    const next = page.next_page_offset;
    if (next === undefined || next === null || typeof next === "object" || page.points.length === 0) break;
    offset = next;
  }
  return [...ids];
}

export async function deletePointsByDocument(
  client: QdrantClient,
  name: string,
  documentId: string,
): Promise<void> {
  await client.delete(name, {
    wait: true,
    filter: { must: [{ key: "document_id", match: { value: documentId } }] },
  });
}

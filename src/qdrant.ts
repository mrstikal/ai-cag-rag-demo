import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";
import { config } from "./config";

export interface ChunkPayload {
  document_id: string;
  chunk_index: number;
  title: string;
  category: string | null;
  locale: string | null;
  status: string;
  valid_from: string | null;
  valid_to: string | null;
  tags: string[];
  source_file: string;
  text: string;
}

export interface Point {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export interface SearchHit {
  id: string | number;
  score: number;
  payload: ChunkPayload;
}

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
  const named = Object.values(vectors as Record<string, { size?: number }>);
  const first = named[0];
  return first && typeof first.size === "number" ? first.size : undefined;
}

export async function createCollection(
  client: QdrantClient,
  name: string,
  dimensions: number,
): Promise<void> {
  await client.createCollection(name, {
    vectors: { size: dimensions, distance: "Cosine" },
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
      vector: point.vector,
      payload: point.payload as unknown as Record<string, unknown>,
    }));
    // Upsert overwrites a point with the same id, so re-seeding is idempotent.
    await client.upsert(name, { wait: true, points: batch });
  }
}

export async function searchPoints(
  client: QdrantClient,
  name: string,
  vector: number[],
  limit: number,
  filter?: Schemas["Filter"],
): Promise<SearchHit[]> {
  const response = await client.query(name, {
    query: vector,
    limit,
    with_payload: true,
    filter,
  });
  return response.points.map((point) => ({
    id: point.id,
    score: point.score,
    payload: point.payload as unknown as ChunkPayload,
  }));
}

export async function countPoints(client: QdrantClient, name: string): Promise<number> {
  const result = await client.count(name, { exact: true });
  return result.count;
}

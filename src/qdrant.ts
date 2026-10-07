import { QdrantClient } from "@qdrant/js-client-rest";
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
): Promise<SearchHit[]> {
  const response = await client.query(name, {
    query: vector,
    limit,
    with_payload: true,
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

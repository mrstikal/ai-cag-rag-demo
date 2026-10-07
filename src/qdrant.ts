import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "./config";
import type { Chunk } from "./chunker";

export interface SearchHit {
  id: string | number;
  score: number;
  payload: ChunkPayload;
}

export interface ChunkPayload {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  title: string;
  category: string;
  locale: string;
  status: string;
  valid_from: string | null;
  valid_to: string | null;
  tags: string[];
  section: string;
  text: string;
  tokens: number;
}

export function createClient(): QdrantClient {
  return new QdrantClient({ url: config.qdrant.url });
}

/**
 * Qdrant point IDs must be uint64 or UUID. We derive a stable UUID from the
 * human-readable chunk id (e.g. "refunds-2026:2") so re-seeding overwrites
 * the same points instead of duplicating them.
 */
export function pointIdFor(documentId: string, chunkIndex: number): string {
  const digest = createHash("sha1").update(`${documentId}:${chunkIndex}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  const byte6 = bytes[6] ?? 0;
  const byte8 = bytes[8] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x50;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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

export async function upsertChunks(
  client: QdrantClient,
  name: string,
  chunks: Chunk[],
  vectors: number[][],
): Promise<void> {
  if (chunks.length !== vectors.length) {
    throw new Error(`Chunk/vector mismatch: ${chunks.length} chunks vs ${vectors.length} vectors`);
  }
  const batchSize = 128;
  for (let start = 0; start < chunks.length; start += batchSize) {
    const points = chunks.slice(start, start + batchSize).map((chunk, offset) => {
      const vector = vectors[start + offset];
      if (!vector) throw new Error(`Missing vector for ${chunk.chunkId}`);
      const payload: ChunkPayload = {
        chunk_id: chunk.chunkId,
        document_id: chunk.documentId,
        chunk_index: chunk.chunkIndex,
        title: chunk.title,
        category: chunk.category,
        locale: chunk.locale,
        status: chunk.status,
        valid_from: chunk.validFrom ?? null,
        valid_to: chunk.validTo ?? null,
        tags: chunk.tags,
        section: chunk.section,
        text: chunk.text,
        tokens: chunk.tokens,
      };
      return {
        id: pointIdFor(chunk.documentId, chunk.chunkIndex),
        vector,
        payload: payload as unknown as Record<string, unknown>,
      };
    });
    await client.upsert(name, { wait: true, points });
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

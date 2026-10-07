import { v5 as uuidv5 } from "uuid";

/**
 * Qdrant point IDs must be an unsigned integer or a UUID, so a human-readable
 * id such as "refunds-2026:2" cannot be used directly. Deriving a name-based
 * UUID v5 keeps the id deterministic: re-seeding documentId + chunkIndex
 * overwrites the same point instead of creating a duplicate.
 */
const NAMESPACE = "a81bc81b-dead-4e5d-abff-90865d1e13b1";

export function chunkId(documentId: string, chunkIndex: number): string {
  return uuidv5(`${documentId}:${chunkIndex}`, NAMESPACE);
}

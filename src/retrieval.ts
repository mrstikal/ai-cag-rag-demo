import type { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "./config";
import { embedText } from "./embeddings";
import { createClient, searchPoints } from "./qdrant";

export interface SearchResult {
  id: string | number;
  score: number;
  documentId: string;
  title: string;
  chunkIndex: number;
  category: string | null;
  locale: string | null;
  status: string;
  sourceFile: string;
  text: string;
}

let client: QdrantClient | undefined;

function qdrant(): QdrantClient {
  if (!client) client = createClient();
  return client;
}

/**
 * Dense retrieval: embed the query with the same model used for documents,
 * then return the nearest chunks by cosine similarity. Shared by the CLI,
 * the web API, and (later) any evaluation script.
 */
export async function semanticSearch(
  query: string,
  limit: number = config.search.topK,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (q === "") return [];

  const vector = await embedText(q);
  const hits = await searchPoints(qdrant(), config.qdrant.collection, vector, limit);

  return hits.map((hit) => ({
    id: hit.id,
    score: hit.score,
    documentId: hit.payload.document_id,
    title: hit.payload.title,
    chunkIndex: hit.payload.chunk_index,
    category: hit.payload.category,
    locale: hit.payload.locale,
    status: hit.payload.status,
    sourceFile: hit.payload.source_file,
    text: hit.payload.text,
  }));
}

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "..");

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type EmbeddingsProvider = "openai" | "mock";

export interface AppConfig {
  embeddings: {
    provider: EmbeddingsProvider;
    apiKey: string | undefined;
    baseURL: string | undefined;
    model: string;
    dimensions: number;
  };
  qdrant: {
    url: string;
    collection: string;
  };
  kb: {
    sourceDir: string;
  };
  chunking: {
    targetTokens: number;
    maxTokens: number;
    overlapTokens: number;
  };
  search: {
    topK: number;
  };
}

function readProvider(): EmbeddingsProvider {
  const raw = readString("EMBEDDINGS_PROVIDER", "openai").toLowerCase();
  if (raw === "mock" || raw === "openai") return raw;
  throw new Error(`Unknown EMBEDDINGS_PROVIDER "${raw}". Use "openai" or "mock".`);
}

export const config: AppConfig = {
  embeddings: {
    provider: readProvider(),
    apiKey: readOptionalString("OPENAI_API_KEY"),
    baseURL: readOptionalString("OPENAI_BASE_URL"),
    model: readString("EMBEDDING_MODEL", "text-embedding-3-small"),
    dimensions: readNumber("EMBEDDING_DIMENSIONS", 1536),
  },
  qdrant: {
    url: readString("QDRANT_URL", "http://localhost:6333"),
    collection: readString("QDRANT_COLLECTION", "knowledge"),
  },
  kb: {
    sourceDir: path.resolve(ROOT_DIR, readString("KB_SOURCE_DIR", "kb/source")),
  },
  chunking: {
    targetTokens: readNumber("CHUNK_TARGET_TOKENS", 500),
    maxTokens: readNumber("CHUNK_MAX_TOKENS", 600),
    overlapTokens: readNumber("CHUNK_OVERLAP_TOKENS", 75),
  },
  search: {
    topK: readNumber("SEARCH_TOP_K", 5),
  },
};

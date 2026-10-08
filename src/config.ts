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

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export type EmbeddingsProvider = "openai" | "mock";
export type RerankerProvider = "local" | "voyage" | "cohere" | "fallback";

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
  search: {
    topK: number;
    prefetchLimit: number;
  };
  eval: {
    candidateDepth: number;
  };
  reranker: {
    provider: RerankerProvider;
    url: string | undefined;
    model: string;
    candidates: number;
    timeoutMs: number;
    voyage: {
      apiKey: string | undefined;
      baseUrl: string;
      model: string;
    };
    cohere: {
      apiKey: string | undefined;
      baseUrl: string;
      model: string;
    };
  };
  generation: {
    model: string;
    topK: number;
  };
  cag: {
    model: string;
    prewarm: boolean;
  };
  agent: {
    maxExtraSearches: number;
    maxChunks: number;
    perSearch: number;
  };
  server: {
    port: number;
  };
}

function readProvider(): EmbeddingsProvider {
  const raw = readString("EMBEDDINGS_PROVIDER", "openai").toLowerCase();
  if (raw === "mock" || raw === "openai") return raw;
  throw new Error(`Unknown EMBEDDINGS_PROVIDER "${raw}". Use "openai" or "mock".`);
}

function readRerankerProvider(): RerankerProvider {
  const raw = readString("RERANKER_PROVIDER", "local").toLowerCase();
  if (raw === "local" || raw === "voyage" || raw === "cohere" || raw === "fallback") return raw;
  throw new Error(`Unknown RERANKER_PROVIDER "${raw}". Use "local", "voyage", "cohere" or "fallback".`);
}

const generationModel = readString("GENERATION_MODEL", "gpt-5.6-terra");

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
  search: {
    topK: readNumber("SEARCH_TOP_K", 5),
    prefetchLimit: readNumber("SEARCH_PREFETCH_LIMIT", 20),
  },
  eval: {
    candidateDepth: readNumber("EVAL_CANDIDATE_DEPTH", 20),
  },
  reranker: {
    provider: readRerankerProvider(),
    url: readOptionalString("RERANKER_URL"),
    model: readString("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3"),
    candidates: readNumber("RERANK_CANDIDATES", 20),
    timeoutMs: readNumber("RERANK_TIMEOUT_MS", 120000),
    voyage: {
      apiKey: readOptionalString("VOYAGE_API_KEY"),
      baseUrl: readString("VOYAGE_BASE_URL", "https://api.voyageai.com"),
      model: readString("VOYAGE_RERANK_MODEL", "rerank-3-lite"),
    },
    cohere: {
      apiKey: readOptionalString("COHERE_API_KEY"),
      baseUrl: readString("COHERE_BASE_URL", "https://api.cohere.com"),
      model: readString("COHERE_RERANK_MODEL", "rerank-v4.0-fast"),
    },
  },
  generation: {
    model: generationModel,
    topK: readNumber("GENERATION_TOP_K", 5),
  },
  cag: {
    model: readString("CAG_MODEL", generationModel),
    prewarm: readBool("CAG_PREWARM", false),
  },
  agent: {
    maxExtraSearches: readNumber("AGENT_MAX_SEARCHES", 2),
    maxChunks: readNumber("AGENT_MAX_CHUNKS", 12),
    perSearch: readNumber("AGENT_SEARCH_RESULTS", 5),
  },
  server: {
    port: readNumber("PORT", 3000),
  },
};

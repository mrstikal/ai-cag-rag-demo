import { createHash } from "node:crypto";
import OpenAI from "openai";
import { config } from "./config";

export interface Embedder {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

const OPENAI_BATCH_SIZE = 96;

class OpenAIEmbedder implements Embedder {
  readonly provider = "openai";
  readonly model: string;
  readonly dimensions: number;
  private readonly client: OpenAI;

  constructor() {
    if (!config.embeddings.apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Add it to .env or set EMBEDDINGS_PROVIDER=mock to run without embeddings API.",
      );
    }
    this.model = config.embeddings.model;
    this.dimensions = config.embeddings.dimensions;
    this.client = new OpenAI({
      apiKey: config.embeddings.apiKey,
      baseURL: config.embeddings.baseURL,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += OPENAI_BATCH_SIZE) {
      const batch = texts
        .slice(start, start + OPENAI_BATCH_SIZE)
        .map((text) => text.replace(/\s+/g, " ").trim() || " ");
      const request: OpenAI.Embeddings.EmbeddingCreateParams = {
        model: this.model,
        input: batch,
      };
      // text-embedding-3-* supports Matryoshka truncation via `dimensions`.
      if (/^text-embedding-3/.test(this.model)) {
        request.dimensions = this.dimensions;
      }
      const response = await this.client.embeddings.create(request);
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      for (const item of ordered) vectors.push(item.embedding);
    }
    return vectors;
  }
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic, dependency-free embedder used for offline demos and tests.
 * It hashes tokens into a fixed-size bag-of-words vector, so cosine
 * similarity is a rough lexical match. It proves the pipeline end to end
 * without requiring an embeddings API key. It is NOT a semantic model.
 */
class MockEmbedder implements Embedder {
  readonly provider = "mock";
  readonly model = "mock-hash-bow";
  readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const token of tokens) {
      const hash = fnv1a(token);
      const index = hash % this.dimensions;
      const sign = (hash >>> 31) & 1 ? -1 : 1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  }
}

export function getEmbedder(): Embedder {
  if (config.embeddings.provider === "mock") {
    return new MockEmbedder(config.embeddings.dimensions);
  }
  return new OpenAIEmbedder();
}

export function vectorFingerprint(vector: number[]): string {
  return createHash("sha1")
    .update(vector.map((value) => value.toFixed(6)).join(","))
    .digest("hex")
    .slice(0, 12);
}

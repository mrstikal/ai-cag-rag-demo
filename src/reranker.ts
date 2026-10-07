import { config } from "./config";

export interface RerankScore {
  index: number;
  score: number;
}

export interface RerankerInfo {
  provider: string;
  model: string;
}

export function rerankerInfo(): RerankerInfo {
  switch (config.reranker.provider) {
    case "voyage":
      return { provider: "voyage", model: config.reranker.voyage.model };
    case "cohere":
      return { provider: "cohere", model: config.reranker.cohere.model };
    case "fallback":
      return { provider: "fallback-lexical", model: "idf-overlap" };
    default:
      return config.reranker.url
        ? { provider: "cross-encoder (local)", model: config.reranker.model }
        : { provider: "fallback-lexical", model: "idf-overlap" };
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Deterministic lexical fallback so the pipeline stays runnable without any
 * reranker. It is NOT a cross-encoder and is labelled as such.
 */
function fallbackRerank(query: string, documents: string[]): RerankScore[] {
  const docTokens = documents.map(tokenize);
  const docFreq = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }
  const total = documents.length || 1;
  const queryTerms = [...new Set(tokenize(query))];

  const scores = documents.map((_doc, index) => {
    const counts = new Map<string, number>();
    for (const token of docTokens[index] ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += idf * (tf / (tf + 1.2));
    }
    return { index, score };
  });

  return scores.sort((a, b) => b.score - a.score);
}

async function fetchJson(url: string, body: unknown, apiKey?: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.reranker.timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`reranker ${url} returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts `[{index, score}]`, `{results:[...]}` (Cohere) or `{data:[...]}` (Voyage). */
function parseScores(payload: unknown): RerankScore[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : null;
  if (!list) throw new Error("reranker response must be an array or { results | data: [...] }");

  return list
    .map((entry) => {
      const record = entry as { index?: unknown; score?: unknown; relevance_score?: unknown };
      const index = Number(record.index);
      const score = Number(record.relevance_score ?? record.score);
      return { index, score };
    })
    .filter((entry) => Number.isInteger(entry.index) && Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);
}

function callLocal(query: string, documents: string[], url: string): Promise<RerankScore[]> {
  return fetchJson(`${url.replace(/\/$/, "")}/rerank`, {
    query,
    documents,
    model: config.reranker.model,
  }).then(parseScores);
}

function callVoyage(query: string, documents: string[]): Promise<RerankScore[]> {
  const { apiKey, baseUrl, model } = config.reranker.voyage;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required when RERANKER_PROVIDER=voyage");
  // Voyage: POST /v1/rerank -> { data: [{ index, relevance_score }] }
  return fetchJson(
    `${baseUrl.replace(/\/$/, "")}/v1/rerank`,
    { query, documents, model, top_k: documents.length },
    apiKey,
  ).then(parseScores);
}

function callCohere(query: string, documents: string[]): Promise<RerankScore[]> {
  const { apiKey, baseUrl, model } = config.reranker.cohere;
  if (!apiKey) throw new Error("COHERE_API_KEY is required when RERANKER_PROVIDER=cohere");
  // Cohere: POST /v2/rerank -> { results: [{ index, relevance_score }] }
  return fetchJson(
    `${baseUrl.replace(/\/$/, "")}/v2/rerank`,
    { query, documents, model, top_n: documents.length },
    apiKey,
  ).then(parseScores);
}

/**
 * Score each candidate chunk against the query. Providers:
 * - "voyage"   Voyage rerank API (cross-encoder over the candidates)
 * - "cohere"   Cohere rerank API
 * - "local"    self-hosted cross-encoder (reranker/app.py)
 * - "fallback" built-in lexical scorer
 * Returns indices into `documents`, sorted by descending relevance.
 */
export async function rerankDocuments(query: string, documents: string[]): Promise<RerankScore[]> {
  if (documents.length === 0) return [];

  switch (config.reranker.provider) {
    case "voyage":
      return callVoyage(query, documents);
    case "cohere":
      return callCohere(query, documents);
    case "fallback":
      return fallbackRerank(query, documents);
    case "local":
    default:
      if (config.reranker.url) return callLocal(query, documents, config.reranker.url);
      return fallbackRerank(query, documents);
  }
}

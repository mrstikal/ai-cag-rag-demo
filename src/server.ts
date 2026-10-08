import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { answerQuestionAgentic } from "./agent";
import { cagAnswer, cagPrewarm } from "./cag";
import { buildReport, DEFAULT_EVAL_FILE, loadEvalQueries } from "./evaluation";
import { answerQuestion, type ContextSource } from "./generation";
import { DEFAULT_GEN_FILE, loadGenerationQuestions, runGenerationEval } from "./generation-eval";
import { search, type Retriever, type SearchFilters } from "./retrieval";

const PUBLIC_DIR = path.resolve(ROOT_DIR, "public");
const MAX_BODY_BYTES = 1_000_000;

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  return JSON.parse(raw) as unknown;
}

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<boolean> {
  const entry = STATIC_FILES[pathname];
  if (!entry) return false;
  try {
    const content = await fs.readFile(path.join(PUBLIC_DIR, entry.file));
    res.writeHead(200, { "Content-Type": entry.contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
  return true;
}

function readFilters(body: unknown): SearchFilters | undefined {
  if (typeof body !== "object" || body === null || !("filters" in body)) return undefined;
  const raw = (body as { filters?: unknown }).filters;
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const filters: SearchFilters = {};
  for (const key of ["status", "locale", "category", "asOf"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") filters[key] = value.trim();
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

async function handleSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  const query =
    typeof body === "object" && body !== null && "query" in body
      ? (body as { query?: unknown }).query
      : undefined;
  if (typeof query !== "string" || query.trim() === "") {
    sendJson(res, 400, { error: "Query is required" });
    return;
  }

  const filters = readFilters(body);

  let retriever: Retriever = "dense";
  if (typeof body === "object" && body !== null && "retriever" in body) {
    const raw = (body as { retriever?: unknown }).retriever;
    if (raw === "dense" || raw === "bm25" || raw === "hybrid" || raw === "rerank") {
      retriever = raw;
    } else if (raw !== undefined && raw !== null && raw !== "") {
      sendJson(res, 400, { error: 'retriever must be "dense", "bm25", "hybrid" or "rerank"' });
      return;
    }
  }

  try {
    const results = await search({ query, limit: config.search.topK, filters, retriever });
    sendJson(res, 200, {
      query: query.trim(),
      provider: config.embeddings.provider,
      retriever,
      filters: filters ?? null,
      results,
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Search failed" });
  }
}

async function handleEvalQueries(res: http.ServerResponse): Promise<void> {
  try {
    const queries = await loadEvalQueries();
    sendJson(res, 200, { queries });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load eval queries" });
  }
}

async function handleEval(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  let topK = config.search.topK;
  if (typeof body === "object" && body !== null && "topK" in body) {
    const raw = (body as { topK?: unknown }).topK;
    if (raw !== undefined && raw !== null && raw !== "") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        sendJson(res, 400, { error: "topK must be a positive integer" });
        return;
      }
      topK = Math.floor(parsed);
    }
  }

  try {
    const report = await buildReport(DEFAULT_EVAL_FILE, topK);
    sendJson(res, 200, report);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Evaluation failed" });
  }
}

function mapSources(sources: ContextSource[]) {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    citation: `${source.chunk.documentId}:v${source.chunk.documentVersion}:chunk-${source.chunk.chunkIndex}`,
    documentId: source.chunk.documentId,
    documentVersion: source.chunk.documentVersion,
    chunkIndex: source.chunk.chunkIndex,
    title: source.chunk.title,
    status: source.chunk.status,
    sourceUri: source.chunk.sourceUri,
    updatedAt: source.chunk.updatedAt,
    rerankScore: source.chunk.rerankScore ?? null,
    text: source.chunk.text,
  }));
}

async function handleAnswer(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  const query =
    typeof body === "object" && body !== null && "query" in body
      ? (body as { query?: unknown }).query
      : undefined;
  if (typeof query !== "string" || query.trim() === "") {
    sendJson(res, 400, { error: "Query is required" });
    return;
  }

  const filters = readFilters(body);

  try {
    const result = await answerQuestion(query, { filters });
    sendJson(res, 200, {
      query: query.trim(),
      status: result.status,
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      sources: mapSources(result.sources),
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Answer failed" });
  }
}

async function handleAgentic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  const query =
    typeof body === "object" && body !== null && "query" in body
      ? (body as { query?: unknown }).query
      : undefined;
  if (typeof query !== "string" || query.trim() === "") {
    sendJson(res, 400, { error: "Query is required" });
    return;
  }

  const filters = readFilters(body);
  const forceSearch =
    typeof body === "object" &&
    body !== null &&
    "forceSearch" in body &&
    (body as { forceSearch?: unknown }).forceSearch === true;

  try {
    const result = await answerQuestionAgentic(query, { filters, forceSearch });
    sendJson(res, 200, {
      query: query.trim(),
      status: result.status,
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      searches: result.searches,
      initialChunks: result.initialChunks,
      uniqueChunks: result.uniqueChunks,
      maxExtraSearches: result.maxExtraSearches,
      sources: mapSources(result.sources),
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Agentic answer failed" });
  }
}

async function handleGenerationQueries(res: http.ServerResponse): Promise<void> {
  try {
    const questions = await loadGenerationQuestions();
    sendJson(res, 200, { questions });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load questions" });
  }
}

async function handleGenerationEval(res: http.ServerResponse): Promise<void> {
  try {
    const report = await runGenerationEval(DEFAULT_GEN_FILE);
    sendJson(res, 200, report);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Generation eval failed" });
  }
}

async function readQuery(body: unknown): Promise<string | undefined> {
  const query =
    typeof body === "object" && body !== null && "query" in body
      ? (body as { query?: unknown }).query
      : undefined;
  return typeof query === "string" && query.trim() !== "" ? query.trim() : undefined;
}

async function handleCag(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  const query = await readQuery(body);
  if (!query) {
    sendJson(res, 400, { error: "Query is required" });
    return;
  }

  try {
    const result = await cagAnswer(query);
    sendJson(res, 200, {
      query,
      status: result.status,
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      contextDocuments: result.contextDocuments,
      contextTokens: result.contextTokens,
      usage: result.usage,
      timings: result.timings,
      sources: result.sources.map((source) => ({
        sourceId: source.sourceId,
        documentId: source.documentId,
        version: source.version,
        title: source.title,
        status: source.status,
        text: source.text,
      })),
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "CAG answer failed" });
  }
}

async function handleCompare(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
    return;
  }

  const query = await readQuery(body);
  if (!query) {
    sendJson(res, 400, { error: "Query is required" });
    return;
  }

  const filters = readFilters(body);

  try {
    // Sequential so the two latencies/caches are not distorted by contention.
    const rag = await answerQuestion(query, { filters });
    const cag = await cagAnswer(query);
    sendJson(res, 200, {
      query,
      rag: {
        status: rag.status,
        answer: rag.answer,
        citations: rag.citations,
        model: rag.model,
        usage: rag.usage,
        timings: rag.timings,
        sourceCount: rag.sources.length,
        sources: mapSources(rag.sources),
      },
      cag: {
        status: cag.status,
        answer: cag.answer,
        citations: cag.citations,
        model: cag.model,
        usage: cag.usage,
        timings: cag.timings,
        contextDocuments: cag.contextDocuments,
        contextTokens: cag.contextTokens,
        sourceCount: cag.sources.length,
        sources: cag.sources,
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Compare failed" });
  }
}

async function handleCagPrewarm(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const result = await cagPrewarm();
    sendJson(res, 200, { status: "warmed", ...result });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Prewarm failed" });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "POST" && url.pathname === "/api/search") {
    void handleSearch(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/answer") {
    void handleAnswer(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agentic") {
    void handleAgentic(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cag") {
    void handleCag(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cag/prewarm") {
    void handleCagPrewarm(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/compare") {
    void handleCompare(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/eval/queries") {
    void handleEvalQueries(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/eval") {
    void handleEval(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/generation/queries") {
    void handleGenerationQueries(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generation/eval") {
    void handleGenerationEval(res);
    return;
  }

  if (req.method === "GET") {
    void serveStatic(res, url.pathname).then((handled) => {
      if (!handled) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
      }
    });
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(config.server.port, () => {
  console.log(`RAG demo UI:  http://localhost:${config.server.port}`);
  console.log(`Embeddings:   ${config.embeddings.provider} / ${config.embeddings.model}`);
  console.log(`Qdrant:       ${config.qdrant.url} -> ${config.qdrant.collection}`);
});

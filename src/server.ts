import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { buildReport, DEFAULT_EVAL_FILE, loadEvalQueries } from "./evaluation";
import { semanticSearch } from "./retrieval";

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

  try {
    const results = await semanticSearch(query, config.search.topK);
    sendJson(res, 200, {
      query: query.trim(),
      provider: config.embeddings.provider,
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "POST" && url.pathname === "/api/search") {
    void handleSearch(req, res);
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

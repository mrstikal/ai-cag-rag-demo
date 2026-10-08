import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import matter from "gray-matter";
import { config } from "./config";
import {
  parseStructuredAnswer,
  usageFrom,
  validateCitations,
  type RagAnswer,
  type Timings,
  type TokenUsage,
} from "./generation";

export interface CagSource {
  sourceId: string;
  documentId: string;
  version: string;
  title: string;
  status: string;
  text: string;
}

export interface CanonicalKnowledgeBase {
  /** SYSTEM_INSTRUCTIONS + full knowledge base — the stable, cacheable prefix. */
  systemPrefix: string;
  documents: CagSource[];
  approxTokens: number;
  /** Signature of the KB files, used to rebuild when the source changes. */
  fingerprint: string;
}

export interface CagResult extends RagAnswer {
  sources: CagSource[];
  model: string;
  contextDocuments: number;
  contextTokens: number;
  usage: TokenUsage;
  timings: Timings;
}

const CAG_SYSTEM_PROMPT = [
  "You answer questions using only the KNOWLEDGE BASE provided below.",
  "",
  "Rules:",
  "- Do not use outside knowledge.",
  "- The entire knowledge base is provided as <DOCUMENT> elements, each with a numeric source id (D1, D2, ...).",
  "- Cite sources using their ids inline, for example [D17] or [D3][D22].",
  "- The citation markers must appear inline in the answer text itself, after every sentence that uses a source. For example: \"Customers may request a refund within 14 days of the initial purchase [D17].\"",
  "- Do not rely on the citations field alone; the same ids must also appear inline in the answer text.",
  "- Never cite a source that was not provided.",
  "- Documents carry Status and Version. If two documents conflict, prefer Status: active; treat Status: obsolete as historical.",
  "- If the knowledge base does not contain enough information, return status \"insufficient\" with an empty citations list.",
  "- Do not guess or fill missing information from general knowledge.",
].join("\n");

function asString(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let cachedKb: CanonicalKnowledgeBase | undefined;

/**
 * Build one deterministic, canonical representation of the whole KB. Documents
 * are ordered by document_id (code-point order, host-locale independent) and
 * serialised with escaping, so the prefix is byte-stable across requests, which
 * is what makes prompt caching effective. Rebuilt automatically when the KB
 * files change (fingerprint of names + mtimes + sizes).
 */
export async function buildCanonicalKnowledgeBase(): Promise<CanonicalKnowledgeBase> {
  const entries = (await fs.readdir(config.kb.sourceDir)).filter((name) => name.endsWith(".md")).sort();
  const stats = await Promise.all(
    entries.map(async (name) => {
      const stat = await fs.stat(path.join(config.kb.sourceDir, name));
      return `${name}:${stat.mtimeMs}:${stat.size}`;
    }),
  );
  const fingerprint = stats.join("|");
  if (cachedKb && cachedKb.fingerprint === fingerprint) return cachedKb;

  const docs: { documentId: string; version: string; title: string; status: string; text: string }[] = [];

  for (const filename of entries) {
    const raw = await fs.readFile(path.join(config.kb.sourceDir, filename), "utf8");
    const { data, content } = matter(raw);
    const documentId = asString(data.id) || filename.replace(/\.md$/, "");
    docs.push({
      documentId,
      version: asString(data.version) || "1",
      title: asString(data.title) || documentId,
      status: asString(data.status) || "active",
      text: content.trim(),
    });
  }

  // Code-point sort: independent of host locale/ICU, unlike localeCompare.
  docs.sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));

  const documents: CagSource[] = docs.map((doc, index) => ({
    sourceId: `D${index + 1}`,
    documentId: doc.documentId,
    version: doc.version,
    title: doc.title,
    status: doc.status,
    text: doc.text,
  }));

  const blocks = documents.map(
    (doc) =>
      `<DOCUMENT source="${xmlEscape(doc.sourceId)}" id="${xmlEscape(doc.documentId)}" version="${xmlEscape(doc.version)}" title="${xmlEscape(doc.title)}" status="${xmlEscape(doc.status)}">\n${xmlEscape(doc.text)}\n</DOCUMENT>`,
  );

  const systemPrefix = `${CAG_SYSTEM_PROMPT}\n\nKNOWLEDGE BASE\n\n${blocks.join("\n\n")}`;
  cachedKb = { systemPrefix, documents, approxTokens: Math.ceil(systemPrefix.length / 4), fingerprint };
  return cachedKb;
}

export function clearCanonicalKnowledgeBase(): void {
  cachedKb = undefined;
}

let client: OpenAI | undefined;

function openai(): OpenAI {
  if (!config.embeddings.apiKey) {
    throw new Error("OPENAI_API_KEY is required for CAG");
  }
  return (client ??= new OpenAI({
    apiKey: config.embeddings.apiKey,
    baseURL: config.embeddings.baseURL,
  }));
}

function buildSchema(sourceIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["answered", "insufficient"] },
      answer: { type: "string" },
      citations: { type: "array", items: { type: "string", enum: sourceIds } },
    },
    required: ["status", "answer", "citations"],
  };
}

/**
 * Cache-Augmented Generation: no retrieval at query time. The whole knowledge
 * base travels in a stable prefix (the same prefix on every request) and the
 * model answers from it directly. Same model and output contract as RAG.
 */
export async function cagAnswer(question: string): Promise<CagResult> {
  const start = Date.now();
  const kb = await buildCanonicalKnowledgeBase();
  const sourceIds = kb.documents.map((doc) => doc.sourceId);
  const model = config.cag.model;

  const generationStart = Date.now();
  const response = await openai().responses.create({
    model,
    input: [
      { role: "system", content: kb.systemPrefix },
      { role: "user", content: question },
    ],
    text: { format: { type: "json_schema", name: "cag_answer", strict: true, schema: buildSchema(sourceIds) } },
  });
  const generationMs = Date.now() - generationStart;

  const answer = parseStructuredAnswer(response.output_text);
  validateCitations(answer, new Set(sourceIds), "D");

  const byId = new Map(kb.documents.map((doc) => [doc.sourceId, doc]));
  const cited = [...new Set(answer.citations)]
    .map((id) => byId.get(id))
    .filter((doc): doc is CagSource => Boolean(doc));

  return {
    ...answer,
    sources: cited,
    model: `openai:${model}`,
    contextDocuments: kb.documents.length,
    contextTokens: kb.approxTokens,
    usage: usageFrom(response),
    timings: { retrievalMs: 0, generationMs, totalMs: Date.now() - start },
  };
}

/**
 * Optional cache warm-up. Issues one request over the stable prefix so the
 * provider can populate its prompt cache before real traffic. Best-effort only.
 */
export async function cagPrewarm(): Promise<{ contextTokens: number }> {
  const kb = await buildCanonicalKnowledgeBase();
  await openai().responses.create({
    model: config.cag.model,
    input: [
      { role: "system", content: kb.systemPrefix },
      { role: "user", content: "Warm-up request. Reply with status insufficient and no citations." },
    ],
    text: {
      format: { type: "json_schema", name: "cag_answer", strict: true, schema: buildSchema(kb.documents.map((d) => d.sourceId)) },
    },
  });
  return { contextTokens: kb.approxTokens };
}

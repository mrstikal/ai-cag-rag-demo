import OpenAI from "openai";
import { config } from "./config";
import { search, type SearchFilters, type SearchResult } from "./retrieval";

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentVersion: string;
  chunkIndex: number;
  title: string;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  sourceUri: string;
  updatedAt: string;
  text: string;
  rerankScore?: number;
}

export interface ContextSource {
  sourceId: string;
  chunk: RetrievedChunk;
  text: string;
}

export type RagStatus = "answered" | "insufficient";

export interface RagAnswer {
  status: RagStatus;
  answer: string;
  citations: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface Timings {
  retrievalMs: number;
  generationMs: number;
  totalMs: number;
}

export interface GenerationResult extends RagAnswer {
  sources: ContextSource[];
  model: string;
  usage?: TokenUsage;
  timings?: Timings;
}

export interface GeneratedAnswer {
  answer: RagAnswer;
  usage: TokenUsage;
}

export interface AnswerGenerator {
  readonly name: string;
  generate(question: string, sources: ContextSource[]): Promise<GeneratedAnswer>;
}

export function usageFrom(response: {
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    input_tokens_details?: { cached_tokens?: number | null } | null;
  } | null;
}): TokenUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

/** Stable, version-aware citation identity, e.g. refunds-2026:v1:chunk-1 */
export function citationId(chunk: RetrievedChunk): string {
  return `${chunk.documentId}:v${chunk.documentVersion}:chunk-${chunk.chunkIndex}`;
}

export function toRetrievedChunk(result: SearchResult): RetrievedChunk {
  return {
    id: String(result.id),
    documentId: result.documentId,
    documentVersion: result.documentVersion,
    chunkIndex: result.chunkIndex,
    title: result.title,
    status: result.status,
    validFrom: result.validFrom,
    validTo: result.validTo,
    sourceUri: result.sourceUri,
    updatedAt: result.updatedAt,
    text: result.text,
    rerankScore: result.rerankScore,
  };
}

export function buildContext(chunks: RetrievedChunk[]): ContextSource[] {
  return chunks.map((chunk, index) => {
    const sourceId = `S${index + 1}`;
    return {
      sourceId,
      chunk,
      text: [
        `[${sourceId}]`,
        `Document: ${chunk.documentId}`,
        `Title: ${chunk.title}`,
        `Chunk: ${chunk.chunkIndex}`,
        `Status: ${chunk.status}`,
        `Valid: ${chunk.validFrom ?? "?"}..${chunk.validTo ?? "(open)"}`,
        `Source: ${citationId(chunk)}`,
        "",
        chunk.text,
      ].join("\n"),
    };
  });
}

const SYSTEM_PROMPT = [
  "You answer questions using only the provided KNOWLEDGE BASE SOURCES.",
  "",
  "Rules:",
  "- Do not use outside knowledge.",
  "- Every factual statement must be supported by the supplied sources.",
  "- Cite sources using their IDs, for example [S1] or [S1][S3].",
  "- The citation markers must appear inline in the answer text itself, e.g. \"Backup codes work [S1].\" Put a marker after every sentence that uses a source; do not rely on the citations field alone.",
  "- Never cite a source that was not provided.",
  "- Sources carry a Status and a validity range. If two sources conflict, prefer the one with Status: active whose validity covers the present; treat Status: obsolete sources as historical and say so if relevant.",
  "- If the sources do not contain enough information to answer reliably, return status \"insufficient\" with an empty citations list and say that the knowledge base does not contain enough information.",
  "- Do not guess or fill missing information from general knowledge.",
].join("\n");

function buildUserPrompt(question: string, sources: ContextSource[]): string {
  return [
    "QUESTION",
    "",
    question,
    "",
    "KNOWLEDGE BASE SOURCES",
    "",
    sources.map((source) => source.text).join("\n\n"),
  ].join("\n");
}

class OpenAIGenerator implements AnswerGenerator {
  readonly name: string;
  private readonly client: OpenAI;

  constructor() {
    if (!config.embeddings.apiKey) {
      throw new Error("OPENAI_API_KEY is required for generation");
    }
    this.name = `openai:${config.generation.model}`;
    this.client = new OpenAI({
      apiKey: config.embeddings.apiKey,
      baseURL: config.embeddings.baseURL,
    });
  }

  async generate(question: string, sources: ContextSource[]): Promise<GeneratedAnswer> {
    const sourceIds = sources.map((source) => source.sourceId);
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["answered", "insufficient"] },
        answer: { type: "string" },
        citations: { type: "array", items: { type: "string", enum: sourceIds } },
      },
      required: ["status", "answer", "citations"],
    };

    const response = await this.client.responses.create({
      model: config.generation.model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(question, sources) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "rag_answer",
          strict: true,
          schema,
        },
      },
    });

    return { answer: JSON.parse(response.output_text) as RagAnswer, usage: usageFrom(response) };
  }
}

let generator: AnswerGenerator | undefined;

export function getGenerator(): AnswerGenerator {
  return (generator ??= new OpenAIGenerator());
}

export function validateCitations(answer: RagAnswer, allowedSources: Set<string>, markerPrefix = "S"): void {
  for (const citation of answer.citations) {
    if (!allowedSources.has(citation)) {
      throw new Error(`Invalid citation: ${citation}`);
    }
  }

  const markerRegex = new RegExp(`\\[(${markerPrefix}\\d+)\\]`, "g");
  const markers = [...answer.answer.matchAll(markerRegex)].map((match) => match[1] ?? "");
  for (const marker of markers) {
    if (!allowedSources.has(marker)) {
      throw new Error(`Unknown source marker: ${marker}`);
    }
  }

  if (answer.status === "answered" && markers.length === 0) {
    throw new Error(`Answered response without citations: "${answer.answer.slice(0, 240)}"`);
  }
}

export interface AnswerOptions {
  topK?: number;
  filters?: SearchFilters;
}

/**
 * One grounded RAG pass: reranked retrieval -> numbered context -> LLM with
 * structured output -> citation validation. Retrieval is unchanged from the
 * earlier steps; this only adds generation on top of the top-k chunks.
 */
export async function answerQuestion(question: string, options: AnswerOptions = {}): Promise<GenerationResult> {
  const start = Date.now();
  const results = await search({
    query: question,
    limit: options.topK ?? config.generation.topK,
    retriever: "rerank",
    filters: options.filters,
  });
  const retrievalMs = Date.now() - start;

  const sources = buildContext(results.map(toRetrievedChunk));
  const gen = getGenerator();

  if (sources.length === 0) {
    return {
      status: "insufficient",
      answer: "The knowledge base does not contain enough information to answer this.",
      citations: [],
      sources: [],
      model: gen.name,
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
      timings: { retrievalMs, generationMs: 0, totalMs: Date.now() - start },
    };
  }

  const generationStart = Date.now();
  const { answer, usage } = await gen.generate(question, sources);
  const generationMs = Date.now() - generationStart;
  validateCitations(answer, new Set(sources.map((source) => source.sourceId)));
  return {
    ...answer,
    sources,
    model: gen.name,
    usage,
    timings: { retrievalMs, generationMs, totalMs: Date.now() - start },
  };
}

export { SYSTEM_PROMPT, buildUserPrompt };

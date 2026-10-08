import OpenAI from "openai";
import { config } from "./config";
import {
  buildContext,
  buildUserPrompt,
  getGenerator,
  toRetrievedChunk,
  validateCitations,
  type ContextSource,
  type GenerationResult,
  type RetrievedChunk,
} from "./generation";
import { search, type SearchFilters, type SearchResult } from "./retrieval";

export interface AgentSearchStep {
  query: string;
  category: string | null;
  added: number;
}

export interface AgenticResult extends GenerationResult {
  searches: AgentSearchStep[];
  initialChunks: number;
  uniqueChunks: number;
  maxExtraSearches: number;
}

const AGENT_SYSTEM_PROMPT = [
  "You are a retrieval-augmented assistant. Answer only from the KNOWLEDGE BASE SOURCES.",
  "You have a tool `search_kb` to fetch more sources when the current sources are insufficient, ambiguous, or you must investigate another aspect (for example a different document or policy).",
  "Call search_kb only when it is genuinely needed. Do not call it if the sources already contain the answer.",
  "The tool accepts only a focused query and an optional category; you cannot set tenant, ACL, status or locale filters.",
  "Do not use outside knowledge. If, after searching, the knowledge base still does not contain the answer, you will say so.",
].join("\n");

const SEARCH_KB_TOOL = {
  type: "function",
  name: "search_kb",
  description:
    "Search the knowledge base when the supplied sources are insufficient, ambiguous, or another aspect of the question must be investigated.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "A focused search query for the missing information" },
      category: { type: ["string", "null"], description: "Optional knowledge-base category to narrow the search" },
    },
    required: ["query", "category"],
  },
};

type ToolsParam = Parameters<OpenAI["responses"]["create"]>[0]["tools"];

let client: OpenAI | undefined;

function openai(): OpenAI {
  if (!config.embeddings.apiKey) {
    throw new Error("OPENAI_API_KEY is required for the agent");
  }
  return (client ??= new OpenAI({
    apiKey: config.embeddings.apiKey,
    baseURL: config.embeddings.baseURL,
  }));
}

interface ToolCall {
  query: string;
  category: string | null;
}

/** One agent turn: decide whether to call search_kb. Returns null when it is done. */
async function planNext(question: string, sources: ContextSource[], forceTool: boolean): Promise<ToolCall | null> {
  const response = await openai().responses.create({
    model: config.generation.model,
    input: [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `${buildUserPrompt(question, sources)}\n\nIf these sources are not enough, call search_kb with a focused query. Otherwise, do not call any tool.`,
      },
    ],
    tools: [SEARCH_KB_TOOL] as unknown as ToolsParam,
    tool_choice: forceTool ? "required" : "auto",
  });

  const call = (response.output ?? []).find(
    (item) => (item as { type?: string }).type === "function_call",
  ) as { arguments?: string } | undefined;
  if (!call || typeof call.arguments !== "string") return null;

  let args: { query?: unknown; category?: unknown };
  try {
    args = JSON.parse(call.arguments) as { query?: unknown; category?: unknown };
  } catch {
    return null; // malformed tool arguments: stop instead of aborting the request
  }
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const category = typeof args.category === "string" && args.category.trim() !== "" ? args.category.trim() : null;
  if (query === "") return null;
  return { query, category };
}

/**
 * Bounded agentic retrieval. The initial retrieval is deterministic; the model
 * may then issue at most `maxExtraSearches` search_kb calls, and only the
 * already-validated retrieval pipeline runs (same dense ∪ bm25 ∪ rerank).
 * The application owns the base filters; the agent can only narrow by category,
 * never bypass tenant/ACL/status/locale. Final answers go through the same
 * structured-output + citation-validation path as single-pass generation.
 */
export async function answerQuestionAgentic(
  question: string,
  options: { filters?: SearchFilters; forceSearch?: boolean } = {},
): Promise<AgenticResult> {
  const baseFilters = options.filters;
  const forceSearch = options.forceSearch === true;
  const startAll = Date.now();
  const chunks = new Map<string, RetrievedChunk>();
  const searches: AgentSearchStep[] = [];

  const gather = async (q: string, category: string | null): Promise<number> => {
    // The application owns the base filters; the agent may only set a category
    // when the application did not already constrain one. status/locale/asOf
    // can never be overridden by the model.
    const narrowed: SearchFilters = { ...baseFilters };
    if (!narrowed.category && category) narrowed.category = category;
    const results: SearchResult[] = await search({
      query: q,
      limit: config.agent.perSearch,
      retriever: "rerank",
      filters: narrowed,
    });
    let added = 0;
    for (const result of results) {
      const chunk = toRetrievedChunk(result);
      if (!chunks.has(chunk.id) && chunks.size < config.agent.maxChunks) {
        chunks.set(chunk.id, chunk);
        added += 1;
      }
    }
    return added;
  };

  await gather(question, null);
  const initialChunks = chunks.size;

  for (let step = 0; step < config.agent.maxExtraSearches; step++) {
    if (chunks.size >= config.agent.maxChunks) break; // pool full: no point searching further
    const sources = buildContext([...chunks.values()]);
    const call = await planNext(question, sources, forceSearch && step === 0);
    if (!call) break;
    const added = await gather(call.query, call.category);
    searches.push({ query: call.query, category: call.category, added });
    if (added === 0) break; // no progress; stop rather than loop
  }

  const sources = buildContext([...chunks.values()]);
  const gen = getGenerator();
  const base = {
    searches,
    initialChunks,
    uniqueChunks: chunks.size,
    maxExtraSearches: config.agent.maxExtraSearches,
    model: gen.name,
  };

  if (sources.length === 0) {
    return {
      status: "insufficient",
      answer: "The knowledge base does not contain enough information to answer this.",
      citations: [],
      sources: [],
      ...base,
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
      timings: { retrievalMs: Date.now() - startAll, generationMs: 0, totalMs: Date.now() - startAll },
    };
  }

  const generationStart = Date.now();
  const { answer, usage } = await gen.generate(question, sources);
  const generationMs = Date.now() - generationStart;
  validateCitations(answer, new Set(sources.map((source) => source.sourceId)));
  return {
    ...answer,
    sources,
    ...base,
    usage,
    timings: {
      retrievalMs: generationStart - startAll,
      generationMs,
      totalMs: Date.now() - startAll,
    },
  };
}

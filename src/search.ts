import { config } from "./config";
import { search, type Retriever, type SearchFilters } from "./retrieval";

interface ParsedArgs {
  query: string;
  topK: number;
  filters: SearchFilters;
  retriever: Retriever;
}

function parseArgs(argv: string[]): ParsedArgs {
  let topK = config.search.topK;
  let retriever: Retriever = "dense";
  const filters: SearchFilters = {};
  const parts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--top" || arg === "-k") {
      const parsed = Number(next);
      if (next === undefined || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--top requires a positive integer");
      }
      topK = Math.floor(parsed);
      i += 1;
    } else if (arg === "--retriever") {
      if (next !== "dense" && next !== "bm25" && next !== "hybrid") {
        throw new Error('--retriever must be "dense", "bm25" or "hybrid"');
      }
      retriever = next;
      i += 1;
    } else if (arg === "--status") {
      if (!next) throw new Error("--status requires a value");
      filters.status = next;
      i += 1;
    } else if (arg === "--locale") {
      if (!next) throw new Error("--locale requires a value");
      filters.locale = next;
      i += 1;
    } else if (arg === "--category") {
      if (!next) throw new Error("--category requires a value");
      filters.category = next;
      i += 1;
    } else if (arg === "--as-of") {
      if (!next) throw new Error("--as-of requires an ISO date");
      filters.asOf = next;
      i += 1;
    } else if (arg !== undefined) {
      parts.push(arg);
    }
  }

  return { query: parts.join(" ").trim(), topK, filters, retriever };
}

function describeFilters(filters: SearchFilters): string {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}=${value}`).join("  ");
}

function stripLeadingHeading(text: string): string {
  const stripped = text.replace(/^#{1,6}\s+.*\n?/, "").trim();
  return stripped !== "" ? stripped : text.trim();
}

function indent(text: string, prefix = "   "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

async function main(): Promise<void> {
  const { query, topK, filters, retriever } = parseArgs(process.argv.slice(2));

  if (query === "" || query === "--help" || query === "-h") {
    console.log('Usage: npm run search -- "your question" [--retriever dense|bm25|hybrid] [--top 5] [--status active] [--locale cs] [--category billing] [--as-of 2025-06-01]');
    process.exitCode = query === "" ? 1 : 0;
    return;
  }

  const results = await search({ query, limit: topK, filters, retriever });

  console.log("QUERY");
  console.log(query);
  console.log(`RETRIEVER  ${retriever}`);
  console.log(`FILTERS    ${describeFilters(filters)}`);
  console.log("");
  console.log(`RESULTS (${results.length})`);

  if (results.length === 0) {
    console.log("");
    console.log("  No matches. Did you run `npm run seed`?");
    return;
  }

  results.forEach((result, index) => {
    console.log("");
    console.log(`${index + 1}. score: ${result.score.toFixed(4)}`);
    console.log(`   title:    ${result.title}`);
    console.log(`   document: ${result.documentId} · chunk ${result.chunkIndex}`);
    console.log(`   status:   ${result.status}   category: ${result.category ?? "-"}   locale: ${result.locale ?? "-"}`);
    console.log("   text:");
    console.log(indent(stripLeadingHeading(result.text)));
  });
}

main().catch((error) => {
  console.error("");
  console.error("Search failed:", error instanceof Error ? error.message : error);
  if (config.embeddings.provider === "openai") {
    console.error("If the OpenAI key or network is unavailable, set EMBEDDINGS_PROVIDER=mock in .env.");
  }
  process.exitCode = 1;
});

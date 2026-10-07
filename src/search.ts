import { config } from "./config";
import { semanticSearch } from "./retrieval";

interface ParsedArgs {
  query: string;
  topK: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  let topK = config.search.topK;
  const parts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--top" || arg === "-k") {
      const value = argv[i + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--top requires a positive integer");
      }
      topK = Math.floor(parsed);
      i += 1;
    } else if (arg !== undefined) {
      parts.push(arg);
    }
  }

  return { query: parts.join(" ").trim(), topK };
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
  const { query, topK } = parseArgs(process.argv.slice(2));

  if (query === "" || query === "--help" || query === "-h") {
    console.log('Usage: npm run search -- "your question" [--top 5]');
    process.exitCode = query === "" ? 1 : 0;
    return;
  }

  const results = await semanticSearch(query, topK);

  console.log("QUERY");
  console.log(query);
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

import { config } from "./config";
import { getEmbedder } from "./embeddings";
import { createClient, searchPoints, type ChunkPayload } from "./qdrant";

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

function indent(text: string, prefix = "   "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function bodyText(payload: ChunkPayload): string {
  const marker = `## ${payload.section}`;
  const text = payload.text.trim();
  const withoutHeading = text.startsWith(marker) ? text.slice(marker.length).trim() : text;
  return withoutHeading.replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const { query, topK } = parseArgs(process.argv.slice(2));

  if (query === "" || query === "--help" || query === "-h") {
    console.log('Usage: npm run search -- "your question" [--top 5]');
    process.exitCode = query === "" ? 1 : 0;
    return;
  }

  const embedder = getEmbedder();
  const client = createClient();

  const [vector] = await embedder.embed([query]);
  if (!vector) throw new Error("Failed to embed the query");

  const hits = await searchPoints(client, config.qdrant.collection, vector, topK);

  console.log("QUERY");
  console.log(query);
  console.log("");
  console.log(`RESULTS (${hits.length})`);

  if (hits.length === 0) {
    console.log("");
    console.log("  No matches. Did you run `npm run seed`?");
    return;
  }

  hits.forEach((hit, index) => {
    const payload = hit.payload;
    console.log("");
    console.log(`${index + 1}. score: ${hit.score.toFixed(4)}`);
    console.log(`   document: ${payload.document_id}`);
    console.log(`   section:  ${payload.section}`);
    console.log(`   status:   ${payload.status}   category: ${payload.category}   locale: ${payload.locale}`);
    console.log(`   chunk:    ${payload.chunk_id}`);
    console.log("   text:");
    console.log(indent(bodyText(payload)));
  });
}

main().catch((error) => {
  console.error("");
  console.error("Search failed:", error instanceof Error ? error.message : error);
  if (config.embeddings.provider === "openai") {
    console.error("If you do not have an OpenAI key, set EMBEDDINGS_PROVIDER=mock in .env.");
  }
  process.exitCode = 1;
});

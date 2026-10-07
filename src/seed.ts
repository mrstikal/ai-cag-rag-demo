import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { config } from "./config";
import { chunkMarkdown } from "./chunker";
import { embedTexts, getEmbedder } from "./embeddings";
import { chunkId } from "./id";
import {
  collectionExists,
  countPoints,
  createClient,
  createCollection,
  createPayloadIndexes,
  getCollectionVectorSize,
  recreateCollection,
  upsertPoints,
  type ChunkPayload,
  type Point,
} from "./qdrant";

function asString(value: unknown): string | null {
  // gray-matter/js-yaml parses unquoted YAML dates (2026-01-01) into Date
  // objects, so normalize those back to an ISO date string.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const single = asString(value);
  return single ? [single] : [];
}

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");
  const embedder = getEmbedder();
  const client = createClient();

  console.log(`Reading knowledge base from ${config.kb.sourceDir}`);
  console.log(`Embeddings:  ${embedder.provider} / ${embedder.model} (${embedder.dimensions}d)`);
  console.log(`Qdrant:      ${config.qdrant.url} -> ${config.qdrant.collection}`);
  console.log("");

  let entries: string[];
  try {
    entries = await fs.readdir(config.kb.sourceDir);
  } catch {
    throw new Error(`Knowledge base directory not found: ${config.kb.sourceDir}`);
  }

  const files = entries.filter((name) => name.endsWith(".md")).sort();
  if (files.length === 0) {
    throw new Error(`No markdown documents found in ${config.kb.sourceDir}`);
  }

  const points: Point[] = [];
  const errors: string[] = [];
  let documents = 0;

  for (const filename of files) {
    try {
      const raw = await fs.readFile(path.join(config.kb.sourceDir, filename), "utf8");
      const { data, content } = matter(raw);
      const documentId = asString(data.id) ?? path.basename(filename, ".md");

      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) {
        errors.push(`${filename}: no content produced any chunks`);
        continue;
      }

      // Embed all chunks of one document in a single request.
      const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));

      for (const chunk of chunks) {
        const vector = embeddings[chunk.index];
        if (!vector) throw new Error(`missing embedding for chunk ${chunk.index}`);
        const payload: ChunkPayload = {
          document_id: documentId,
          chunk_index: chunk.index,
          title: asString(data.title) ?? documentId,
          category: asString(data.category),
          locale: asString(data.locale),
          status: asString(data.status) ?? "active",
          valid_from: asString(data.valid_from),
          valid_to: asString(data.valid_to),
          tags: asStringList(data.tags),
          source_file: filename,
          text: chunk.text,
        };
        points.push({ id: chunkId(documentId, chunk.index), vector, payload });
      }

      documents += 1;
      console.log(`${filename}: ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`);
    } catch (error) {
      errors.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (points.length === 0) {
    throw new Error("Nothing to index.");
  }

  if (reset) {
    console.log("");
    console.log(`Recreating collection "${config.qdrant.collection}"...`);
    await recreateCollection(client, config.qdrant.collection, embedder.dimensions);
  } else if (await collectionExists(client, config.qdrant.collection)) {
    const existingSize = await getCollectionVectorSize(client, config.qdrant.collection);
    if (existingSize !== undefined && existingSize !== embedder.dimensions) {
      throw new Error(
        `Collection "${config.qdrant.collection}" has vector size ${existingSize} but embeddings are ${embedder.dimensions}d. Run with --reset.`,
      );
    }
  } else {
    await createCollection(client, config.qdrant.collection, embedder.dimensions);
  }

  // Create payload indexes before upserting so ingestion keeps them up to date.
  console.log("Ensuring payload indexes...");
  await createPayloadIndexes(client, config.qdrant.collection);

  console.log("");
  console.log(`Upserting ${points.length} points...`);
  await upsertPoints(client, config.qdrant.collection, points);
  const total = await countPoints(client, config.qdrant.collection);

  console.log("");
  console.log("Documents:", documents);
  console.log("Chunks:   ", points.length);
  console.log("Vectors:  ", points.length);
  console.log("Errors:   ", errors.length);
  for (const error of errors) console.log(`  ! ${error}`);
  console.log("");
  console.log(`Collection "${config.qdrant.collection}" now holds ${total} points.`);
  console.log('Next: npm run search -- "your question"');
}

main().catch((error) => {
  console.error("");
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  if (config.embeddings.provider === "openai") {
    console.error("If the OpenAI key or network is unavailable, set EMBEDDINGS_PROVIDER=mock in .env.");
  }
  process.exitCode = 1;
});

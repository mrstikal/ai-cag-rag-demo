import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import {
  chunkDocument,
  firstString,
  parseFrontmatter,
  stringList,
  type Chunk,
  type DocumentMetadata,
} from "./chunker";
import { getEmbedder } from "./embeddings";
import {
  collectionExists,
  countPoints,
  createClient,
  createCollection,
  getCollectionVectorSize,
  recreateCollection,
  upsertChunks,
} from "./qdrant";

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

  const allChunks: Chunk[] = [];
  const errors: string[] = [];
  let documents = 0;

  for (const file of files) {
    const filePath = path.join(config.kb.sourceDir, file);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const { data, content } = parseFrontmatter(raw);
      const fallbackId = file.replace(/\.md$/i, "");
      const id = firstString(data, "id") ?? fallbackId;
      const meta: DocumentMetadata = {
        id,
        title: firstString(data, "title") ?? id,
        category: firstString(data, "category") ?? "uncategorized",
        locale: firstString(data, "locale") ?? "en",
        status: firstString(data, "status") ?? "active",
        validFrom: firstString(data, "valid_from"),
        validTo: firstString(data, "valid_to"),
        tags: stringList(data, "tags"),
      };
      const chunks = chunkDocument(content, meta, config.chunking);
      if (chunks.length === 0) {
        errors.push(`${file}: no content produced any chunks`);
        continue;
      }
      allChunks.push(...chunks);
      documents += 1;
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Embedding ${allChunks.length} chunks...`);
  const vectors = await embedder.embed(allChunks.map((chunk) => chunk.text));

  if (reset) {
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

  console.log(`Upserting ${allChunks.length} points...`);
  await upsertChunks(client, config.qdrant.collection, allChunks, vectors);
  const total = await countPoints(client, config.qdrant.collection);

  console.log("");
  console.log("Documents:", documents);
  console.log("Chunks:   ", allChunks.length);
  console.log("Vectors:  ", vectors.length);
  console.log("Errors:   ", errors.length);
  if (errors.length > 0) {
    console.log("");
    for (const error of errors) console.log(`  ! ${error}`);
  }
  console.log("");
  console.log(`Collection "${config.qdrant.collection}" now holds ${total} points.`);
  console.log("Next: npm run search -- \"your question\"");
}

main().catch((error) => {
  console.error("");
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  if (config.embeddings.provider === "openai") {
    console.error("If you do not have an OpenAI key, set EMBEDDINGS_PROVIDER=mock in .env.");
  }
  process.exitCode = 1;
});

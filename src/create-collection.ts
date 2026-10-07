import "dotenv/config";
import { config } from "./config";
import { getEmbedder } from "./embeddings";
import { collectionExists, createClient, createCollection } from "./qdrant";

async function main(): Promise<void> {
  const embedder = getEmbedder();
  const client = createClient();

  if (await collectionExists(client, config.qdrant.collection)) {
    console.log(`Collection "${config.qdrant.collection}" already exists.`);
    return;
  }

  await createCollection(client, config.qdrant.collection, embedder.dimensions);
  console.log(
    `Created collection "${config.qdrant.collection}" (size ${embedder.dimensions}, distance Cosine).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

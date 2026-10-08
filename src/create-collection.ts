import "dotenv/config";
import { config } from "./config";
import { collectionExists, createClient, createCollection, createPayloadIndexes } from "./qdrant";

async function main(): Promise<void> {
  const client = createClient();
  const dimensions = config.embeddings.dimensions;

  if (await collectionExists(client, config.qdrant.collection)) {
    console.log(`Collection "${config.qdrant.collection}" already exists.`);
  } else {
    await createCollection(client, config.qdrant.collection, dimensions);
    console.log(`Created collection "${config.qdrant.collection}" (size ${dimensions}, distance Cosine).`);
  }

  // Idempotent: createPayloadIndex is a no-op when the index already exists.
  await createPayloadIndexes(client, config.qdrant.collection);
  console.log("Payload indexes ensured.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

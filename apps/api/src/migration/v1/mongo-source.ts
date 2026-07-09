import type { MigrationConfig } from "./config";
const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { MongoClient } = requireFromApi("mongodb");

/** Read-only fetch of verified docs. Never writes to Mongo. */
export async function fetchVerified(
  cfg: MigrationConfig,
  collection: "properties" | "pgs"
): Promise<any[]> {
  const client = new MongoClient(cfg.mongoUrl);
  await client.connect();
  try {
    const db = client.db(cfg.mongoDb);
    const docs = await db.collection(collection).find({ verified: true }).toArray();
    // Coerce ObjectId _id → hex string for stable keys.
    return docs.map((d: any) => ({ ...d, _id: String(d._id) }));
  } finally {
    await client.close();
  }
}

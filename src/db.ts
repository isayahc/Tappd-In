import { MongoClient } from "mongodb";
import type { PlatformUser, ProspectProfile, ResearchJob } from "./models.js";

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI in .env before running database commands");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || "tappd_in");
    return {
      client,
      users: db.collection<PlatformUser>("users"),
      profiles: db.collection<ProspectProfile>("prospect_profiles"),
      jobs: db.collection<ResearchJob>("research_jobs"),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
export type Database = Awaited<ReturnType<typeof connectDatabase>>;

export async function ensureIndexes(db: Database) {
  await Promise.all([
    db.users.createIndex({ userId: 1 }, { unique: true }),
    db.profiles.createIndex({ userId: 1 }, { unique: true }),
    db.jobs.createIndex({ jobId: 1 }, { unique: true }),
    db.jobs.createIndex({ status: 1, createdAt: 1 }),
    // One active research job per platform user.
    db.jobs.createIndex({ userId: 1 }, {
      unique: true, partialFilterExpression: { status: { $in: ["queued", "running"] } },
    }),
  ]);
}

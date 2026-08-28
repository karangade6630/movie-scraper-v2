import { MongoClient, Db, Collection } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI environment variable is missing!");
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri!);
  await client.connect();
  db = client.db("movie_scraper");
  console.log("Connected to MongoDB successfully");
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("Database not initialized. Call connectToDatabase first.");
  }
  return db;
}

export function getMoviesCollection(): Collection {
  return getDb().collection("movies");
}

export function getProxiesCollection(): Collection {
  return getDb().collection("proxies");
}

export function getSeenLinksCollection(): Collection {
  return getDb().collection("seen_links");
}

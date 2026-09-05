import { MongoClient, Db, Collection } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;

let client: MongoClient | null = null;
let db: Db | null = null;

// In-memory fallback collection for environments without MongoDB configured
class InMemoryCollection {
  private data: any[] = [];
  
  async find(query: any = {}, options?: any) {
    let results = [...this.data];
    return {
      sort: () => ({
        skip: () => ({
          limit: () => ({
            toArray: async () => results
          }),
          toArray: async () => results
        }),
        toArray: async () => results
      }),
      toArray: async () => results,
      countDocuments: async () => results.length,
      limit: () => ({ toArray: async () => results })
    };
  }

  async findOne(query: any) {
    if (!query) return this.data[0] || null;
    if (query.id !== undefined) {
      return this.data.find(d => d.id === query.id);
    }
    if (query.title) {
      return this.data.find(d => d.title === query.title);
    }
    if (query._id) {
      return this.data.find(d => d._id === query._id);
    }
    return this.data[0] || null;
  }

  async insertOne(doc: any) {
    this.data.push(doc);
    return { insertedId: doc._id || doc.id };
  }

  async insertMany(docs: any[]) {
    this.data.push(...docs);
    return { insertedCount: docs.length };
  }

  async updateOne(query: any, update: any, options?: any) {
    const item = await this.findOne(query);
    if (item && update.$set) {
      Object.assign(item, update.$set);
    } else if (!item && options?.upsert) {
      const newDoc = { ...(query._id ? { _id: query._id } : {}), ...update.$set };
      this.data.push(newDoc);
    }
    return { modifiedCount: item ? 1 : 0 };
  }

  async findOneAndUpdate(query: any, update: any, options?: any) {
    let item = await this.findOne(query);
    if (!item && options?.upsert) {
      item = { ...(query._id ? { _id: query._id } : {}), seq: 0 };
      this.data.push(item);
    }
    if (item && update.$inc) {
      for (const key of Object.keys(update.$inc)) {
        item[key] = (item[key] || 0) + update.$inc[key];
      }
    }
    return item;
  }

  async deleteMany(query: any = {}) {
    const count = this.data.length;
    this.data = [];
    return { deletedCount: count };
  }

  async countDocuments(query: any = {}) {
    return this.data.length;
  }

  async distinct(field: string) {
    const values = new Set(this.data.map(d => d[field]).filter(v => v !== undefined));
    return Array.from(values);
  }

  aggregate(pipeline: any[]) {
    return {
      toArray: async () => this.data
    };
  }
}

const mockMovies = new InMemoryCollection();
const mockProxies = new InMemoryCollection();
const mockSeen = new InMemoryCollection();
const mockCounters = new InMemoryCollection();

class MockDb {
  collection(name: string) {
    if (name === "movies") return mockMovies;
    if (name === "proxies") return mockProxies;
    if (name === "seen_links") return mockSeen;
    if (name === "counters") return mockCounters;
    return new InMemoryCollection();
  }
}

const mockDbInstance = new MockDb();

export async function connectToDatabase(): Promise<any> {
  if (db) return db;
  if (
    !uri ||
    (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) ||
    uri.includes("<username>") ||
    uri.includes("<password>")
  ) {
    console.warn("WARNING: MONGODB_URI is missing, invalid, or contains placeholders. Using in-memory fallback store.");
    return null;
  }
  try {
    client = new MongoClient(uri, {
      tls: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 15000,
    });
    await client.connect();
    db = client.db("movie_scraper");
    console.log("Connected to MongoDB successfully");
    return db;
  } catch (err) {
    console.error("Failed to connect to MongoDB, using in-memory fallback:", err);
    return null;
  }
}

export function getDb(): any {
  if (!db) {
    return mockDbInstance;
  }
  return db;
}

export function getMoviesCollection(): any {
  if (!db) return mockMovies;
  return db.collection("movies");
}

export function getProxiesCollection(): any {
  if (!db) return mockProxies;
  return db.collection("proxies");
}

export function getSeenLinksCollection(): any {
  if (!db) return mockSeen;
  return db.collection("seen_links");
}

export function getCountersCollection(): any {
  if (!db) return mockCounters;
  return db.collection("counters");
}

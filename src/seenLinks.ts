import { getSeenLinksCollection } from "./db.ts";

/**
 * Load the set of seen links from MongoDB.
 * Returns an empty set if error.
 */
export async function loadSeenLinks(): Promise<Set<string>> {
  try {
    const col = getSeenLinksCollection();
    const docs = await col.find({}).toArray();
    return new Set(docs.map((d: any) => d.url));
  } catch (err) {
    console.error("Error loading seen links:", err);
    return new Set();
  }
}

/**
 * Express router for managing seen links via API
 */
import express, { Request, Response } from "express";

const seenLinksRouter = express.Router();

// GET /api/seen-links - return all seen links as an array
seenLinksRouter.get("/", async (req: Request, res: Response) => {
  try {
    const col = getSeenLinksCollection();
    const docs = await col.find({}).toArray();
    const links = docs.map(d => d.url);
    const last_updated = docs.length > 0 ? (docs[docs.length - 1].last_updated || new Date()) : new Date();
    res.json({ 
      success: true, 
      links, 
      count: links.length, 
      last_updated: new Date(last_updated).toISOString() 
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/seen-links - add a new link to the seen set
// Expected JSON body: { link: string }
seenLinksRouter.post("/", async (req: Request, res: Response) => {
  const { link } = req.body;
  if (typeof link !== "string" || !link.trim()) {
    return res.status(400).json({ success: false, error: "Invalid link" });
  }
  const trimmed = link.trim();
  try {
    const col = getSeenLinksCollection();
    await col.updateOne(
      { url: trimmed },
      { $set: { url: trimmed, last_updated: new Date() } },
      { upsert: true }
    );
    const count = await col.countDocuments();
    res.json({ 
      success: true, 
      message: "Link added", 
      link: trimmed, 
      count, 
      last_updated: new Date().toISOString() 
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/seen-links - clear all seen links
seenLinksRouter.delete("/", async (req: Request, res: Response) => {
  try {
    const col = getSeenLinksCollection();
    await col.deleteMany({});
    res.json({ success: true, message: "All seen links cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default seenLinksRouter;

/**
 * Persist the provided set of seen links to MongoDB.
 */
export async function saveSeenLinks(seen: Set<string>): Promise<void> {
  try {
    const col = getSeenLinksCollection();
    await col.deleteMany({});
    const arr = Array.from(seen);
    if (arr.length > 0) {
      await col.insertMany(arr.map(url => ({ url, last_updated: new Date() })));
    }
  } catch (err) {
    console.error("Error saving seen links:", err);
  }
}

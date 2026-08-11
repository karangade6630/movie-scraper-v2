import fs from "fs";
import path from "path";

const seenLinksDir = path.join(process.cwd(), "seen_links");
const seenLinksFile = path.join(seenLinksDir, "seen_links.json");

/**
 * Load the set of seen links from the JSON file.
 * Returns an empty set if the file does not exist or cannot be parsed.
 */
export function loadSeenLinks(): Set<string> {
  try {
    const raw = fs.readFileSync(seenLinksFile, "utf-8");
    const parsed = JSON.parse(raw);
    const linksArray: string[] = Array.isArray(parsed) ? parsed : (parsed.links ?? []);
    return new Set(linksArray);
  } catch {
    return new Set();
  }
}

/**
 * Express router for managing seen links via API
 */
import express, { Request, Response } from "express";

const seenLinksRouter = express.Router();

// GET /api/seen-links - return all seen links as an array
seenLinksRouter.get("/", (req: Request, res: Response) => {
  try {
    const raw = fs.readFileSync(seenLinksFile, "utf-8");
    const parsed = JSON.parse(raw);
    res.json({ 
      success: true, 
      links: parsed.links || [], 
      count: parsed.count || 0, 
      last_updated: parsed.last_updated || new Date().toISOString() 
    });
  } catch {
    res.json({ success: true, links: [], count: 0, last_updated: new Date().toISOString() });
  }
});

// POST /api/seen-links - add a new link to the seen set
// Expected JSON body: { link: string }
seenLinksRouter.post("/", (req: Request, res: Response) => {
  const { link } = req.body;
  if (typeof link !== "string" || !link.trim()) {
    return res.status(400).json({ success: false, error: "Invalid link" });
  }
  const seen = loadSeenLinks();
  seen.add(link.trim());
  saveSeenLinks(seen);
  res.json({ success: true, message: "Link added", link, count: seen.size, last_updated: new Date().toISOString() });
});

// DELETE /api/seen-links - clear all seen links
seenLinksRouter.delete("/", (req: Request, res: Response) => {
  saveSeenLinks(new Set());
  res.json({ success: true, message: "All seen links cleared" });
});

export default seenLinksRouter;

/**
 * Persist the provided set of seen links to the JSON file.
 */
export function saveSeenLinks(seen: Set<string>): void {
  if (!fs.existsSync(seenLinksDir)) {
    fs.mkdirSync(seenLinksDir, { recursive: true });
  }
  const arr = Array.from(seen);
  const payload = {
    links: arr,
    count: arr.length,
    last_updated: new Date().toISOString()
  };
  fs.writeFileSync(seenLinksFile, JSON.stringify(payload, null, 2), "utf-8");
}

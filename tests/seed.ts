// preload: seeds the in-memory DB with the kinds of corrupted records seen in production
import { getMoviesCollection } from "../src/db.ts";
const S = `http://movies4u.test:${process.env.MOCK_PORT}`;
const col = getMoviesCollection();
const base = { cleaned_title: "", release_year: "2026", quality: "WEB-DL", poster_url: "", page_num: 1, priority: 0, scraped_at: "" };
await col.insertOne({ ...base, id: 101, title: "Hidden Gem", detail_url: `${S}/`, links: [] });               // homepage stored as detail_url (the reported bug)
await col.insertOne({ ...base, id: 102, title: "Rajni The Jailer 2", detail_url: `http://movies4u.old:${process.env.MOCK_PORT}/rajni-the-jailer-2-2026-hindi-full-movie/`, links: [] }); // old domain
await col.insertOne({ ...base, id: 103, title: "Empty Movie", detail_url: `${S}/empty-movie-2026-hindi/`, links: [{ quality: "720P", links: [{ text: "Old", url: "http://keep.me/1", alternatives: [] }] }] }); // page has no links; must keep existing
await col.insertOne({ ...base, id: 104, title: "Nobody Has Heard Of This", detail_url: "https://tinyurl.com/xprime4u", links: [{ quality: "720P", links: [{ text: "Old", url: "http://keep.me/2", alternatives: [] }] }] }); // unfindable

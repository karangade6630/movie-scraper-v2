import React, { useState, useEffect } from "react";
import { Movie } from "./types";
import { Header } from "./components/Header";
import { ScraperControls } from "./components/ScraperControls";
import { MovieList } from "./components/MovieList";
import { Film, Sparkles, Server } from "lucide-react";

export default function App() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [lastScrapedInfo, setLastScrapedInfo] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchMovies = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/movies?t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setMovies(data.movies);
      }
    } catch (err: any) {
      console.error("Error fetching movies:", err);
      setErrorMsg("Failed to load movies from SQLite database.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMovies();
  }, []);

  const handleScrape = async (startPage: number, endPage: number) => {
    try {
      setIsScraping(true);
      setErrorMsg(null);
      setLastScrapedInfo("");

      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startPage, endPage })
      });

      const data = await res.json();
      if (data.success) {
        setMovies(data.movies);
        setLastScrapedInfo(`Successfully scraped ${data.newScraped} new movies from pages ${startPage} to ${endPage}. Total in DB: ${data.totalCount}`);
        if (data.errors && data.errors.length > 0) {
          setErrorMsg(data.errors.join("; "));
        }
      } else {
        setErrorMsg(data.error || "Scraping failed.");
      }
    } catch (err: any) {
      console.error("Scraping error:", err);
      setErrorMsg("Failed to connect to scraper service.");
    } finally {
      setIsScraping(false);
    }
  };

  const handleClearDb = async () => {
    try {
      const res = await fetch("/api/movies", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setMovies([]);
        setLastScrapedInfo("Database cleared successfully.");
        fetchMovies();
      }
    } catch (err: any) {
      console.error("Clear DB error:", err);
      setErrorMsg("Failed to clear database.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-red-600 selection:text-white">
      <Header totalCount={movies.length} onClear={handleClearDb} isScraping={isScraping} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero Banner / Instructions */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-red-950/40 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center space-x-2 bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Movies4U Live Scraper & SQLite Storage</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
              Browse, Scrape & Manage Movies
            </h2>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Scrape movie titles, release years, qualities (Web-DL, HDRip, BluRay), poster links, and video source URLs from <span className="text-white font-semibold">new2.movies4u.clinic</span>. All data is persisted in a server-side SQLite database.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-red-950/60 border border-red-800 text-red-200 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white font-bold text-xs ml-4">
              DISMISS
            </button>
          </div>
        )}

        {/* Scraper Controls */}
        <ScraperControls
          onScrape={handleScrape}
          isScraping={isScraping}
          lastScrapedInfo={lastScrapedInfo}
        />

        {/* Movie Library */}
        <MovieList movies={movies} isLoading={isLoading} />
      </main>

      <footer className="bg-slate-900 border-t border-slate-800 py-6 mt-16 text-center text-xs text-slate-400">
        <p>Movies4U Scraper & SQLite Library • Built with Node.js, Express, Cheerio & SQLite (sql.js)</p>
      </footer>
    </div>
  );
}

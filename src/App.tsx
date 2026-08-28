import React, { useState, useEffect } from "react";
import { Movie } from "./types";
import { Header } from "./components/Header";
import { ScraperControls } from "./components/ScraperControls";
import { MovieList } from "./components/MovieList";
import { Dashboard } from "./components/Dashboard";
import {
  Film,
  Sparkles,
  Server,
  LayoutDashboard,
  Database,
} from "lucide-react";

export default function App() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [lastScrapedInfo, setLastScrapedInfo] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState<boolean>(false);
  const [scrapingStatus, setScrapingStatus] = useState({
    fullScrape: { message: "Idle", progress: 0 },
    monitoring: { message: "Idle", progress: 0 },
  });

  // Server-side filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedQuality, setSelectedQuality] = useState("ALL");
  const [selectedPage, setSelectedPage] = useState<string | number>("1"); // Page 1 by default
  const [sortBy, setSortBy] = useState<"newest" | "title" | "year">("newest");
  const [availablePages, setAvailablePages] = useState<(string | number)[]>(["ALL"]);
  const [availableQualities, setAvailableQualities] = useState<string[]>(["ALL"]);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Pagination states
  const [resultPage, setResultPage] = useState<number>(1);
  const [matchingCount, setMatchingCount] = useState<number>(0);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/scraper/status");
      const data = await res.json();
      setScrapingStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchMovies = async (filters = {
    search: searchTerm,
    quality: selectedQuality,
    pageNum: selectedPage,
    page: resultPage,
  }, append = false) => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      params.append("t", Date.now().toString());
      if (filters.search) {
        params.append("search", filters.search);
      }
      if (filters.quality && filters.quality !== "ALL") {
        params.append("quality", filters.quality);
      }
      if (filters.pageNum && filters.pageNum !== "ALL") {
        params.append("pageNum", filters.pageNum.toString());
      }
      if (filters.page) {
        params.append("page", filters.page.toString());
      }
      params.append("limit", "30");

      const res = await fetch(`/api/movies?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setMovies((prev) => append ? [...prev, ...data.movies] : data.movies);
        setTotalCount(data.total || data.movies.length);
        setMatchingCount(data.matchingCount !== undefined ? data.matchingCount : data.movies.length);
        if (data.pages) {
          setAvailablePages(["ALL", ...data.pages]);
        }
        if (data.qualities) {
          setAvailableQualities(["ALL", ...data.qualities]);
        }
      }
    } catch (err: any) {
      console.error("Error fetching movies:", err);
      setErrorMsg("Failed to load movies from MongoDB database.");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch movies reactively on filter changes (resets result page to 1)
  useEffect(() => {
    setResultPage(1);
    fetchMovies({
      search: searchTerm,
      quality: selectedQuality,
      pageNum: selectedPage,
      page: 1,
    }, false);
  }, [searchTerm, selectedQuality, selectedPage]);

  // Fetch more movies when page changes (appends to list)
  const loadMoreMovies = () => {
    const nextPage = resultPage + 1;
    setResultPage(nextPage);
    fetchMovies({
      search: searchTerm,
      quality: selectedQuality,
      pageNum: selectedPage,
      page: nextPage,
    }, true);
  };


  const handleScrape = async (startPage: number, endPage: number) => {
    try {
      setIsScraping(true);
      setErrorMsg(null);
      setLastScrapedInfo("");

      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startPage, endPage }),
      });

      const data = await res.json();
      if (data.success) {
        setMovies(data.movies);
        setLastScrapedInfo(
          `Successfully scraped ${data.newScraped} new movies from pages ${startPage} to ${endPage}. Total in DB: ${data.totalCount}`,
        );
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

  const handleTogglePriority = async (id: number, currentPriority: number) => {
    const newPriority = currentPriority > 0 ? 0 : 1;
    // Optimistic update
    setMovies((prev) =>
      prev
        .map((m) => (m.id === id ? { ...m, priority: newPriority } : m))
        .sort((a, b) => {
          const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
          if (pDiff !== 0) return pDiff;
          return a.id - b.id;
        })
    );

    try {
      const res = await fetch(`/api/movies/${id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.error || "Failed to update movie priority.");
        fetchMovies(); // rollback
      }
    } catch (err: any) {
      console.error("Error toggling priority:", err);
      setErrorMsg("Failed to update movie priority.");
      fetchMovies(); // rollback
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-red-600 selection:text-white">
      <Header
        totalCount={totalCount}
        onClear={handleClearDb}
        isScraping={isScraping}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero Banner / Instructions */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-red-950/40 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center space-x-2 bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Movies4U Live Scraper & MongoDB Storage</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
              Browse, Scrape & Manage Movies
            </h2>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Scrape movie titles, release years, qualities (Web-DL, HDRip,
              BluRay), poster links, and video source URLs from{" "}
              <span className="text-white font-semibold">
                new2.movies4u.clinic
              </span>
              . All data is persisted in a server-side MongoDB database.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-red-950/60 border border-red-800 text-red-200 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
            <span>{errorMsg}</span>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-red-400 hover:text-white font-bold text-xs ml-4"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* Scraper Controls */}
        <div className="bg-slate-800 p-4 rounded-xl space-y-4">
          <div className="flex-1">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Full Scrape</span>
              <span>{scrapingStatus.fullScrape.progress}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${scrapingStatus.fullScrape.progress}%` }}
              ></div>
            </div>
            <div className="text-xs text-slate-400 font-mono mt-1 truncate">
              {scrapingStatus.fullScrape.message}
            </div>
          </div>
          <div className="flex-1">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Monitoring</span>
              <span>{scrapingStatus.monitoring.progress}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${scrapingStatus.monitoring.progress}%` }}
              ></div>
            </div>
            <div className="text-xs text-slate-400 font-mono mt-1 truncate">
              {scrapingStatus.monitoring.message}
            </div>
          </div>
        </div>

        <ScraperControls
          onScrape={handleScrape}
          isScraping={isScraping}
          lastScrapedInfo={lastScrapedInfo}
        />

        <div className="flex justify-end">
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className="flex items-center text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg transition"
          >
            {showDashboard ? (
              <Film className="w-4 h-4 mr-2" />
            ) : (
              <LayoutDashboard className="w-4 h-4 mr-2" />
            )}
            {showDashboard ? "Back to Scraper" : "Show Database & Proxies"}
          </button>
        </div>

        {/* Movie Library */}
        {showDashboard ? (
          <Dashboard
            isScraping={isScraping}
            setIsScraping={setIsScraping}
            scrapingStatus={scrapingStatus}
          />
        ) : (
          <MovieList
            movies={movies}
            isLoading={isLoading}
            onTogglePriority={handleTogglePriority}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedQuality={selectedQuality}
            setSelectedQuality={setSelectedQuality}
            selectedPage={selectedPage}
            setSelectedPage={setSelectedPage}
            sortBy={sortBy}
            setSortBy={setSortBy}
            availablePages={availablePages}
            availableQualities={availableQualities}
            totalMovies={totalCount}
            onLoadMore={loadMoreMovies}
            hasMore={movies.length < matchingCount}
          />
        )}
      </main>

      <footer className="bg-slate-900 border-t border-slate-800 py-6 mt-16 text-center text-xs text-slate-400">
        <p>
          Movies4U Scraper & MongoDB Library • Built with Node.js, Express,
          Cheerio & MongoDB
        </p>
      </footer>
    </div>
  );
}

import React, { useMemo, useState } from "react";
import { Movie, MovieQualityGroup } from "../types";
import { MovieCard } from "./MovieCard";
import {
  Search,
  Filter,
  Film,
  ArrowUpDown,
  Layers,
  CheckSquare,
  Square,
  RefreshCw,
  Copy,
  Download,
  Check,
  X,
  Server,
} from "lucide-react";

interface MovieListProps {
  movies: Movie[];
  isLoading: boolean;
  onTogglePriority?: (id: number, currentPriority: number) => void;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  selectedQuality: string;
  setSelectedQuality: (val: string) => void;
  selectedPage: string | number;
  setSelectedPage: (val: string | number) => void;
  sortBy: "newest" | "title" | "year";
  setSortBy: (val: "newest" | "title" | "year") => void;
  availablePages: (string | number)[];
  availableQualities: string[];
  totalMovies: number;
  onLoadMore?: () => void;
  hasMore?: boolean;
  onMovieUpdated?: (updatedMovie: Movie) => void;
  onRefreshMovies?: () => void;
  preferredServer?: string;
  onPreferredServerChange?: (server: string) => void;
}

export const MovieList: React.FC<MovieListProps> = ({
  movies,
  isLoading,
  onTogglePriority,
  searchTerm,
  setSearchTerm,
  selectedQuality,
  setSelectedQuality,
  selectedPage,
  setSelectedPage,
  sortBy,
  setSortBy,
  availablePages,
  availableQualities,
  totalMovies,
  onLoadMore,
  hasMore,
  onMovieUpdated,
  onRefreshMovies,
  preferredServer = "pixeldrain",
  onPreferredServerChange,
}) => {
  const [selectedMovieIds, setSelectedMovieIds] = useState<Set<number>>(new Set());
  const [isBatchFetching, setIsBatchFetching] = useState<boolean>(false);
  const [batchCopied, setBatchCopied] = useState<boolean>(false);

  // Sort movies (filtering is handled server-side)
  const filteredMovies = useMemo(() => {
    return [...movies].sort((a, b) => {
      const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (pDiff !== 0) return pDiff;

      if (sortBy === "newest") return b.id - a.id;
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "year") return b.release_year.localeCompare(a.release_year);
      return 0;
    });
  }, [movies, sortBy]);

  // Toggle selection for a single movie
  const handleToggleSelect = (id: number) => {
    setSelectedMovieIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all or deselect all
  const handleToggleSelectAll = () => {
    if (selectedMovieIds.size === filteredMovies.length) {
      setSelectedMovieIds(new Set());
    } else {
      setSelectedMovieIds(new Set(filteredMovies.map((m) => m.id)));
    }
  };

  // Batch fetch links for all qualities of selected movies with preferred server
  const handleBatchFetchLinks = async () => {
    if (selectedMovieIds.size === 0) return;
    try {
      setIsBatchFetching(true);
      const res = await fetch("/api/movies/batch-fetch-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedMovieIds),
          preferredServer,
        }),
      });
      const data = await res.json();
      if (data.success && onMovieUpdated && data.movies) {
        data.movies.forEach((m: Movie) => onMovieUpdated(m));
      } else if (data.success && onRefreshMovies) {
        onRefreshMovies();
      }
    } catch (e) {
      console.error("Batch fetch failed:", e);
    } finally {
      setIsBatchFetching(false);
    }
  };

  // Copy links of all selected movies formatted
  const handleCopySelectedLinks = () => {
    const selected = filteredMovies.filter((m) => selectedMovieIds.has(m.id));
    const lines: string[] = [];

    selected.forEach((m) => {
      let groups: MovieQualityGroup[] = [];
      try {
        groups = typeof m.links === "string" ? JSON.parse(m.links) : m.links;
      } catch {
        groups = [];
      }
      lines.push(`🎬 ${m.title} (${m.release_year})`);
      groups.forEach((g) => {
        g.links.forEach((l) => {
          lines.push(`  [${g.quality}] ${l.text}: ${l.url}`);
        });
      });
      lines.push("");
    });

    navigator.clipboard.writeText(lines.join("\n"));
    setBatchCopied(true);
    setTimeout(() => setBatchCopied(false), 2000);
  };

  // Export selected movies as text file
  const handleExportTxt = () => {
    const selected = filteredMovies.filter((m) => selectedMovieIds.has(m.id));
    const lines: string[] = [];
    selected.forEach((m) => {
      let groups: MovieQualityGroup[] = [];
      try {
        groups = typeof m.links === "string" ? JSON.parse(m.links) : m.links;
      } catch {
        groups = [];
      }
      lines.push(`${m.title} (${m.release_year}) - ${m.quality}`);
      groups.forEach((g) => {
        g.links.forEach((l) => {
          lines.push(`  ${g.quality} - ${l.text}: ${l.url}`);
        });
      });
      lines.push("");
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movies_links_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isAllSelected = filteredMovies.length > 0 && selectedMovieIds.size === filteredMovies.length;

  return (
    <div className="space-y-6">
      {/* Search & Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col lg:flex-row gap-4 items-center justify-between">
        {/* Search input */}
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search movie name or year..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
          />
        </div>

        {/* Dropdown Filters & Server Selector */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Server / Label Priority Filter */}
          <div className="flex items-center space-x-2 bg-red-50/70 border border-red-200 rounded-xl px-3 py-1.5 shadow-2xs">
            <Server className="w-3.5 h-3.5 text-red-600" />
            <span className="text-xs font-bold text-red-900">Server:</span>
            <select
              value={preferredServer}
              onChange={(e) => onPreferredServerChange && onPreferredServerChange(e.target.value)}
              className="bg-transparent text-xs font-bold text-red-800 focus:outline-none cursor-pointer"
              title="Select global preferred server / label"
            >
              <option value="pixeldrain">Pixeldrain (Priority)</option>
              <option value="fsl">FSL Server</option>
              <option value="10gbps">10Gbps Server</option>
              <option value="hubcloud">HubCloud DD</option>
              <option value="gdflix">GDFlix</option>
            </select>
          </div>

          {/* Quality Filter */}
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600">Quality:</span>
            <select
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              {availableQualities.map((q) => (
                <option key={q} value={q}>
                  {q === "ALL" ? "All Qualities" : q}
                </option>
              ))}
            </select>
          </div>

          {/* Page Filter */}
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600">Page:</span>
            <select
              value={selectedPage}
              onChange={(e) => setSelectedPage(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              {availablePages.map((p) => (
                <option key={p} value={p}>
                  {p === "ALL" ? "All Pages" : `Page ${p}`}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="newest">Latest Scraped</option>
              <option value="title">Title (A-Z)</option>
              <option value="year">Release Year</option>
            </select>
          </div>
        </div>
      </div>

      {/* Selection Control & Results Count Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleToggleSelectAll}
            className="flex items-center space-x-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            {isAllSelected ? (
              <CheckSquare className="w-4 h-4 text-red-400" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span>{isAllSelected ? "Deselect All" : "Select All"}</span>
          </button>

          <span className="text-xs text-slate-400">
            {selectedMovieIds.size > 0 ? (
              <span className="text-amber-400 font-bold">{selectedMovieIds.size} movies selected</span>
            ) : (
              <span>Showing <strong className="text-white">{filteredMovies.length}</strong> of {totalMovies} in Database</span>
            )}
          </span>
        </div>

        {/* Selected Movies Batch Actions */}
        {selectedMovieIds.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleBatchFetchLinks}
              disabled={isBatchFetching}
              className="flex items-center space-x-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isBatchFetching ? "animate-spin" : ""}`} />
              <span>{isBatchFetching ? "Fetching Links..." : `Fetch All Qualities (${selectedMovieIds.size}) [${preferredServer.toUpperCase()}]`}</span>
            </button>

            <button
              onClick={handleCopySelectedLinks}
              className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              {batchCopied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{batchCopied ? "Copied!" : "Copy Links"}</span>
            </button>

            <button
              onClick={handleExportTxt}
              title="Download selected links as TXT"
              className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export TXT</span>
            </button>

            <button
              onClick={() => setSelectedMovieIds(new Set())}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Movie Grid or Empty State */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 animate-pulse">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <div key={n} className="bg-slate-800 aspect-[2/3] rounded-2xl" />
          ))}
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Film className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">No movies found</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
            {movies.length === 0
              ? "No movies scraped yet. Use the scraper controls above to fetch movies from the site!"
              : "No movies match your current search criteria or filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {filteredMovies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                onTogglePriority={onTogglePriority}
                isSelected={selectedMovieIds.has(movie.id)}
                onToggleSelect={handleToggleSelect}
                onMovieUpdated={onMovieUpdated}
                defaultServerPref={preferredServer}
              />
            ))}
          </div>

          {hasMore && onLoadMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={onLoadMore}
                disabled={isLoading}
                className="bg-slate-900 hover:bg-red-600 text-white text-sm font-semibold px-6 py-3 rounded-xl transition duration-300 shadow-md disabled:bg-slate-800/50 disabled:text-slate-500 cursor-pointer"
              >
                {isLoading ? "Loading..." : "Load More Movies"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

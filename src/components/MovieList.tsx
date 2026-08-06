import React, { useState, useMemo } from "react";
import { Movie } from "../types";
import { MovieCard } from "./MovieCard";
import { Search, Filter, Film, ArrowUpDown, Layers } from "lucide-react";

interface MovieListProps {
  movies: Movie[];
  isLoading: boolean;
}

export const MovieList: React.FC<MovieListProps> = ({ movies, isLoading }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedQuality, setSelectedQuality] = useState("ALL");
  const [selectedPage, setSelectedPage] = useState("ALL");
  const [sortBy, setSortBy] = useState<"newest" | "title" | "year">("newest");

  // Extract unique qualities and pages for filters
  const qualities = useMemo(() => {
    const qSet = new Set(movies.map((m) => m.quality));
    return ["ALL", ...Array.from(qSet)];
  }, [movies]);

  const pages = useMemo(() => {
    const pSet = new Set(movies.map((m) => m.page_num));
    const sortedPages = Array.from(pSet).sort((a, b) => Number(a) - Number(b));
    return ["ALL", ...sortedPages];
  }, [movies]);

  // Filter and sort movies
  const filteredMovies = useMemo(() => {
    return movies
      .filter((movie) => {
        const matchesSearch =
          movie.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          movie.release_year.includes(searchTerm);
        const matchesQuality = selectedQuality === "ALL" || movie.quality === selectedQuality;
        const matchesPage = selectedPage === "ALL" || movie.page_num === Number(selectedPage);
        return matchesSearch && matchesQuality && matchesPage;
      })
      .sort((a, b) => {
        if (sortBy === "newest") return b.id - a.id;
        if (sortBy === "title") return a.title.localeCompare(b.title);
        if (sortBy === "year") return b.release_year.localeCompare(a.release_year);
        return 0;
      });
  }, [movies, searchTerm, selectedQuality, selectedPage, sortBy]);

  return (
    <div className="space-y-6">
      {/* Search & Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between">
        {/* Search input */}
        <div className="relative w-full lg:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by movie name or year..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
          />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Quality Filter */}
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600">Quality:</span>
            <select
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              {qualities.map((q) => (
                <option key={q} value={q}>
                  {q}
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
              {pages.map((p) => (
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

      {/* Results Count */}
      <div className="flex items-center justify-between text-sm text-slate-600 px-1">
        <span>
          Showing <strong className="text-slate-900">{filteredMovies.length}</strong> of {movies.length} movies in SQLite
        </span>
      </div>

      {/* Movie Grid or Empty State */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 animate-pulse">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <div key={n} className="bg-slate-200 aspect-[2/3] rounded-2xl" />
          ))}
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Film className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">No movies found</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
            {movies.length === 0
              ? "No movies scraped yet. Use the scraper controls above to fetch movies from movies4u.clinic!"
              : "No movies match your current search criteria or filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {filteredMovies.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </div>
      )}
    </div>
  );
};

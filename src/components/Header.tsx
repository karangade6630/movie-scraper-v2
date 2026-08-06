import React from "react";
import { Film, Database, RefreshCw, Trash2, Search } from "lucide-react";

interface HeaderProps {
  totalCount: number;
  onClear: () => void;
  isScraping: boolean;
}

export const Header: React.FC<HeaderProps> = ({ totalCount, onClear, isScraping }) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-red-600 p-2 rounded-xl text-white shadow-lg shadow-red-600/30 flex items-center justify-center">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-red-400 bg-clip-text text-transparent">
              Movies4U Scraper & Library
            </h1>
            <p className="text-xs text-slate-400">
              Scraped from <span className="text-red-400 font-medium">movies4u.clinic</span> & stored in SQLite
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center space-x-2 bg-slate-800/80 border border-slate-700/60 px-3 py-1.5 rounded-lg text-sm text-slate-300">
            <Database className="w-4 h-4 text-red-400" />
            <span>Saved Movies: <strong className="text-white font-semibold">{totalCount}</strong></span>
          </div>

          {totalCount > 0 && (
            <button
              onClick={onClear}
              disabled={isScraping}
              title="Clear all stored movies"
              className="flex items-center space-x-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-800/60 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline">Clear DB</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

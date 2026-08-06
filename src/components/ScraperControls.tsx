import React, { useState } from "react";
import { Download, Loader2, Play, Sparkles } from "lucide-react";

interface ScraperControlsProps {
  onScrape: (start: number, end: number) => void;
  isScraping: boolean;
  lastScrapedInfo?: string;
}

export const ScraperControls: React.FC<ScraperControlsProps> = ({ onScrape, isScraping, lastScrapedInfo }) => {
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number>(3);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onScrape(startPage, endPage);
  };

  const handleQuickPreset = (start: number, end: number) => {
    setStartPage(start);
    setEndPage(end);
    onScrape(start, end);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-red-600" />
            Scrape Movies from Movies4U
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Specify a page range (e.g., pages 1 to 3) to extract movie titles, release years, qualities, posters, and video links into SQLite.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleQuickPreset(1, 1)}
            disabled={isScraping}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Page 1 Only
          </button>
          <button
            onClick={() => handleQuickPreset(1, 3)}
            disabled={isScraping}
            className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Pages 1 - 3 (Default)
          </button>
          <button
            onClick={() => handleQuickPreset(1, 5)}
            disabled={isScraping}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Pages 1 - 5
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <div className="flex items-center space-x-2">
            <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">Start Page:</label>
            <input
              type="number"
              min="1"
              max="50"
              value={startPage}
              onChange={(e) => setStartPage(parseInt(e.target.value) || 1)}
              disabled={isScraping}
              className="w-20 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">End Page:</label>
            <input
              type="number"
              min="1"
              max="50"
              value={endPage}
              onChange={(e) => setEndPage(parseInt(e.target.value) || 1)}
              disabled={isScraping}
              className="w-20 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isScraping}
          className="w-full sm:w-auto flex-1 flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-md shadow-red-600/20 transition-all disabled:opacity-50 cursor-pointer"
        >
          {isScraping ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Scraping Pages {startPage} to {endPage}...</span>
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              <span>Start Scraping (Pages {startPage}-{endPage})</span>
            </>
          )}
        </button>
      </form>

      {lastScrapedInfo && (
        <p className="text-xs text-emerald-600 font-medium mt-3 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
          {lastScrapedInfo}
        </p>
      )}
    </div>
  );
};

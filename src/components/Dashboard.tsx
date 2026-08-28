import React, { useState, useEffect } from "react";
import { RefreshCw, Server, Database, Zap } from "lucide-react";

export const Dashboard = ({
  isScraping,
  setIsScraping,
  scrapingStatus,
}: any) => {
  const [dbData, setDbData] = useState<any[]>([]);
  const [proxies, setProxies] = useState<any[]>([]);
  const [pageNumFilter, setPageNumFilter] = useState<number | null>(null);
  const [proxyPage, setProxyPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDbData = async (pPage = proxyPage, pNum = pageNumFilter) => {
    console.log(`Fetching: pPage=${pPage}, pNum=${pNum}`);
    setLoading(true);
    try {
      const [resMovies, resProxies] = await Promise.all([
        fetch(`/api/movies?pageNum=${pNum ?? ""}`),
        fetch(`/api/proxies?page=${pPage}`),
      ]);
      const dataMovies = await resMovies.json();
      const dataProxies = await resProxies.json();
      if (dataMovies.success) {
        setDbData(dataMovies.movies);
      }
      if (dataProxies.success) {
        setProxies(dataProxies.proxies);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshProxies = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/proxies/refresh", { method: "POST" });
      await fetchDbData();
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  const testProxy = async (url: string) => {
    try {
      await fetch("/api/proxies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      await fetchDbData();
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDbData(proxyPage, pageNumFilter);
  }, [proxyPage, pageNumFilter]);
  useEffect(() => {
    setPageNumFilter(1);

    return () => {};
  }, []);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center text-white">
          <Database className="w-5 h-5 mr-2 text-red-500" />
          Database Inspector
        </h2>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const res = await fetch("/api/scraper/toggle", {
                method: "POST",
              });
              const data = await res.json();
              setIsScraping(data.isScraping);
            }}
            className={`flex items-center text-sm px-3 py-1.5 rounded-lg transition ${isScraping ? "bg-red-900 text-red-200 hover:bg-red-800" : "bg-green-900 text-green-200 hover:bg-green-800"}`}
          >
            {isScraping ? "Pause Scraper" : "Start Scraper"}
          </button>
          <input
            type="number"
            placeholder="Page Num"
            className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm w-24"
            onChange={(e) => {
              setPageNumFilter(
                e.target.value ? parseInt(e.target.value) : null,
              );
            }}
          />
          <button
            onClick={() => fetchDbData()}
            className="flex items-center text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </button>
        </div>
      </div>

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

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-slate-400">
          <thead className="text-xs text-slate-300 uppercase bg-slate-800">
            <tr>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Quality</th>
              <th className="px-4 py-3">Scraped At</th>
              <th className="px-4 py-3">Link</th>
            </tr>
          </thead>
          <tbody>
            {dbData.map((movie) => (
              <tr
                key={movie.id}
                className={`border-b border-slate-800 hover:bg-slate-800/50 ${
                  (movie.priority ?? 0) > 0 ? "bg-amber-950/20" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <button
                    onClick={async () => {
                      const newP = (movie.priority ?? 0) > 0 ? 0 : 1;
                      await fetch(`/api/movies/${movie.id}/priority`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ priority: newP }),
                      });
                      fetchDbData();
                    }}
                    className={`text-xs px-2 py-1 rounded font-semibold transition ${
                      (movie.priority ?? 0) > 0
                        ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    {(movie.priority ?? 0) > 0 ? "★ Priority" : "☆ Normal"}
                  </button>
                </td>
                <td className="px-4 py-3 font-mono">{movie.id}</td>
                <td className="px-4 py-3 text-slate-200 flex items-center gap-2">
                  {movie.poster_url ? (
                    <img
                      src={movie.poster_url}
                      alt={movie.title}
                      className="w-8 h-12 object-cover rounded"
                      onError={(e) =>
                        (e.currentTarget.src =
                          "https://via.placeholder.com/32x48")
                      }
                    />
                  ) : (
                    <div className="w-8 h-12 bg-slate-700 rounded" />
                  )}
                  {movie.title}
                </td>
                <td className="px-4 py-3">{movie.quality}</td>
                <td className="px-4 py-3 text-xs">{movie.scraped_at}</td>
                <td className="px-4 py-3 text-xs">
                  <a
                    href={movie.links}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs bg-slate-700 px-2 py-1 rounded hover:bg-slate-600"
                  >
                    Link
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between items-center mt-4">
          <span>Showing {dbData.length} movies</span>
        </div>
      </div>

      <div className="border-t border-slate-800 pt-6">
        <h2 className="text-xl font-bold flex items-center text-white mb-4">
          <Server className="w-5 h-5 mr-2 text-red-500" />
          Proxy Status
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-400">
            <thead className="text-xs text-slate-300 uppercase bg-slate-800">
              <tr>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Latency (ms)</th>
                <th className="px-4 py-3">Last Checked</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((proxy) => (
                <tr
                  key={proxy.id}
                  className="border-b border-slate-800 hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3 font-mono text-slate-200">
                    {proxy.url}
                  </td>
                  <td className="px-4 py-3">{proxy.latency || "N/A"}</td>
                  <td className="px-4 py-3 text-xs">
                    {proxy.last_checked}
                    <button
                      onClick={() => testProxy(proxy.url)}
                      className="ml-2 text-xs bg-slate-700 px-2 py-0.5 rounded hover:bg-slate-600"
                    >
                      Check
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center mt-4">
            <button
              disabled={proxyPage === 1}
              onClick={() => {
                setProxyPage(proxyPage - 1);
              }}
              className="text-sm px-3 py-1 bg-slate-800 rounded disabled:opacity-50"
            >
              Prev
            </button>
            <span>Page {proxyPage}</span>
            <button
              onClick={() => {
                setProxyPage(proxyPage + 1);
              }}
              className="text-sm px-3 py-1 bg-slate-800 rounded"
            >
              Next
            </button>
          </div>
        </div>
        <button
          onClick={refreshProxies}
          disabled={refreshing}
          className="mt-4 flex items-center text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition disabled:bg-red-800"
        >
          <Zap className="w-4 h-4 mr-1.5" />
          {refreshing ? "Fetching..." : "Force Proxy Fetch"}
        </button>
      </div>
    </div>
  );
};

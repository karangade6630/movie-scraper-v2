import React, { useState } from "react";
import { Movie, MovieQualityGroup } from "../types";
import {
  Calendar,
  ExternalLink,
  Layers,
  Star,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Check,
  CheckSquare,
  Square,
  Link as LinkIcon,
  X,
  Sparkles,
  Server,
  ArrowRightLeft,
} from "lucide-react";

interface MovieCardProps {
  movie: Movie;
  onTogglePriority?: (id: number, currentPriority: number) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
  onMovieUpdated?: (updatedMovie: Movie) => void;
  defaultServerPref?: string;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  onTogglePriority,
  isSelected = false,
  onToggleSelect,
  onMovieUpdated,
  defaultServerPref = "pixeldrain",
}) => {
  const [isFetchingLinks, setIsFetchingLinks] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [copiedLinkUrl, setCopiedLinkUrl] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);
  const [serverPref, setServerPref] = useState<string>(movie.preferred_server || defaultServerPref);

  // Parse links safely
  let parsedLinks: MovieQualityGroup[] = [];
  try {
    parsedLinks = typeof movie.links === "string" ? JSON.parse(movie.links) : movie.links;
  } catch (e) {
    console.error("Failed to parse links", e);
  }

  // Manage modal form state
  const [editQuality, setEditQuality] = useState("1080P");
  const [editCustomQuality, setEditCustomQuality] = useState("");
  const [editServerChoice, setEditServerChoice] = useState("Pixeldrain");
  const [editCustomServer, setEditCustomServer] = useState("");
  const [editLinkUrl, setEditLinkUrl] = useState("");
  const [isSavingLinks, setIsSavingLinks] = useState(false);

  const isPriority = (movie.priority ?? 0) > 0;

  // Change preferred server for this movie and immediately re-evaluate active links
  const handleServerPrefChange = async (newPref: string) => {
    setServerPref(newPref);
    try {
      const res = await fetch(`/api/movies/${movie.id}/preferred-server`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredServer: newPref }),
      });
      const data = await res.json();
      if (data.success && data.movie && onMovieUpdated) {
        onMovieUpdated(data.movie);
      }
    } catch (e) {
      console.error("Failed to update preferred server:", e);
    }
  };

  // Switch server for a specific quality directly from alternatives
  const handleSwitchServer = async (quality: string, alt: { text: string; url: string }) => {
    try {
      const res = await fetch(`/api/movies/${movie.id}/select-server`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quality,
          targetServerText: alt.text,
          targetUrl: alt.url,
        }),
      });
      const data = await res.json();
      if (data.success && data.movie && onMovieUpdated) {
        onMovieUpdated(data.movie);
      }
    } catch (e) {
      console.error("Failed to switch server:", e);
    }
  };

  // On-demand fetch links for all qualities of this specific movie with server preference
  const handleFetchLinks = async () => {
    try {
      setIsFetchingLinks(true);
      setFetchNotice(null);
      const res = await fetch(`/api/movies/${movie.id}/fetch-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredServer: serverPref }),
      });
      const data = await res.json();
      if (data.success && data.movie && onMovieUpdated) {
        onMovieUpdated(data.movie);
        let groups: MovieQualityGroup[] = [];
        try {
          groups = typeof data.movie.links === "string" ? JSON.parse(data.movie.links) : data.movie.links;
        } catch {
          groups = [];
        }
        const qualityNames = groups.map((g) => g.quality).join(", ");
        setFetchNotice(
          groups.length > 0
            ? `Fetched ${groups.length} qualities (${qualityNames}) [${serverPref.toUpperCase()}]`
            : "No download links currently found on source."
        );
        setTimeout(() => setFetchNotice(null), 4000);
      } else if (!data.success) {
        setFetchNotice(data.error || "Failed to fetch links.");
        setTimeout(() => setFetchNotice(null), 4000);
      }
    } catch (err) {
      console.error("Failed to fetch links for movie:", err);
      setFetchNotice("Error connecting to fetch service.");
      setTimeout(() => setFetchNotice(null), 4000);
    } finally {
      setIsFetchingLinks(false);
    }
  };

  // Copy link to clipboard
  const handleCopyLink = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedLinkUrl(url);
    setTimeout(() => setCopiedLinkUrl(null), 2000);
  };

  // Add custom link to this movie
  const handleAddLink = async () => {
    if (!editLinkUrl.trim()) return;
    const finalQuality = editQuality === "CUSTOM" ? (editCustomQuality.trim() || "General") : editQuality;
    const finalLabel = editServerChoice === "CUSTOM" ? (editCustomServer.trim() || "Download") : editServerChoice;

    const updatedGroups = [...parsedLinks];
    let qGroup = updatedGroups.find((g) => g.quality.toUpperCase() === finalQuality.toUpperCase());
    if (!qGroup) {
      qGroup = { quality: finalQuality, links: [] };
      updatedGroups.push(qGroup);
    }

    // Add or replace link for this quality
    if (!qGroup.links.some((l) => l.url === editLinkUrl.trim())) {
      qGroup.links.push({
        text: finalLabel,
        url: editLinkUrl.trim(),
        selected: true,
        alternatives: [{ text: finalLabel, url: editLinkUrl.trim() }],
      });
    }

    try {
      setIsSavingLinks(true);
      const res = await fetch(`/api/movies/${movie.id}/links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: updatedGroups }),
      });
      const data = await res.json();
      if (data.success && onMovieUpdated) {
        onMovieUpdated({ ...movie, links: data.links });
        setEditLinkUrl("");
        setEditCustomServer("");
      }
    } catch (e) {
      console.error("Failed to save links:", e);
    } finally {
      setIsSavingLinks(false);
    }
  };

  // Delete a specific link from this movie
  const handleDeleteLink = async (quality: string, url: string) => {
    const updatedGroups = parsedLinks
      .map((g) => {
        if (g.quality === quality) {
          return { ...g, links: g.links.filter((l) => l.url !== url) };
        }
        return g;
      })
      .filter((g) => g.links.length > 0);

    try {
      setIsSavingLinks(true);
      const res = await fetch(`/api/movies/${movie.id}/links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: updatedGroups }),
      });
      const data = await res.json();
      if (data.success && onMovieUpdated) {
        onMovieUpdated({ ...movie, links: data.links });
      }
    } catch (e) {
      console.error("Failed to delete link:", e);
    } finally {
      setIsSavingLinks(false);
    }
  };

  // Toggle selection on a specific link
  const handleToggleLinkSelection = async (quality: string, url: string) => {
    const updatedGroups = parsedLinks.map((g) => {
      if (g.quality === quality) {
        return {
          ...g,
          links: g.links.map((l) => (l.url === url ? { ...l, selected: !l.selected } : l)),
        };
      }
      return g;
    });

    try {
      const res = await fetch(`/api/movies/${movie.id}/links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: updatedGroups }),
      });
      const data = await res.json();
      if (data.success && onMovieUpdated) {
        onMovieUpdated({ ...movie, links: data.links });
      }
    } catch (e) {
      console.error("Failed to toggle link selection:", e);
    }
  };

  return (
    <>
      <div
        className={`bg-white border rounded-2xl overflow-hidden shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col group relative ${
          isSelected
            ? "ring-2 ring-red-500 border-red-400 bg-red-50/10"
            : isPriority
            ? "ring-2 ring-amber-400 border-amber-300"
            : "border-slate-200"
        }`}
      >
        {/* Selection Checkbox on top-left of Card */}
        {onToggleSelect && (
          <button
            onClick={() => onToggleSelect(movie.id)}
            title={isSelected ? "Deselect Movie" : "Select Movie"}
            className="absolute top-2.5 left-2.5 z-20 bg-slate-900/80 backdrop-blur-md hover:bg-slate-900 text-white p-1 rounded-lg shadow-md transition-colors cursor-pointer flex items-center justify-center border border-white/20"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-red-400" />
            ) : (
              <Square className="w-4 h-4 text-slate-300" />
            )}
          </button>
        )}

        {/* Priority Ribbon / Badge if prioritized */}
        {isPriority && (
          <div className="absolute top-0 right-0 z-20 bg-gradient-to-l from-amber-500 to-amber-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-bl-lg shadow-md flex items-center gap-1">
            <Star className="w-3 h-3 fill-white" />
            <span>PRIORITY</span>
          </div>
        )}

        {/* Poster Container */}
        <div className="relative aspect-[2/3] bg-slate-900 overflow-hidden">
          <img
            src={movie.poster_url}
            alt={movie.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-transparent to-transparent opacity-85" />

          {/* Quality Badge */}
          <div
            className={`absolute ${
              onToggleSelect ? "top-2.5 left-10" : "top-2.5 left-2.5"
            } bg-red-600/90 backdrop-blur-md text-white font-bold text-[10px] px-2 py-0.5 rounded-md shadow-md uppercase tracking-wider`}
          >
            {movie.quality}
          </div>

          {/* Page Badge */}
          <div
            className={`absolute ${
              isPriority ? "top-7" : "top-2.5"
            } right-2.5 bg-slate-900/80 backdrop-blur-md text-slate-200 font-medium text-[10px] px-2 py-0.5 rounded-md border border-slate-700/50 flex items-center gap-1`}
          >
            <Layers className="w-3 h-3 text-red-400" />
            <span>Pg {movie.page_num}</span>
          </div>

          {/* Quick Actions overlay on top-right of Poster */}
          <div className="absolute top-10 right-2.5 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
            <button
              onClick={handleFetchLinks}
              disabled={isFetchingLinks}
              title={`Fetch links for all qualities (${serverPref})`}
              className="bg-slate-900/90 hover:bg-red-600 text-white p-1.5 rounded-lg shadow-md border border-slate-700 hover:border-red-500 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isFetchingLinks ? "animate-spin text-red-400" : ""}`}
              />
            </button>
            <button
              onClick={() => setShowManageModal(true)}
              title="Select, manage, or add links"
              className="bg-slate-900/90 hover:bg-blue-600 text-white p-1.5 rounded-lg shadow-md border border-slate-700 hover:border-blue-500 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Title & Year overlay on bottom of poster */}
          <div className="absolute bottom-2.5 left-2.5 right-2.5">
            <div className="flex items-center space-x-1.5 text-xs text-slate-300 mb-0.5 font-medium">
              <Calendar className="w-3 h-3 text-red-400" />
              <span>{movie.release_year}</span>
            </div>
            <h3 className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow-md">
              {movie.title}
            </h3>
          </div>
        </div>

        {/* Notice badge if just fetched */}
        {fetchNotice && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-600 text-[10px] font-semibold px-2.5 py-1 text-center truncate">
            {fetchNotice}
          </div>
        )}

        {/* Footer / Link Buttons */}
        <div className="p-3 bg-white flex flex-col gap-2.5 mt-auto border-t border-slate-100">
          {/* Server / Label Selector for this Movie */}
          <div className="flex items-center justify-between text-xs bg-slate-50 p-1.5 rounded-lg border border-slate-200">
            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-600 uppercase">
              <Server className="w-3 h-3 text-red-500 shrink-0" />
              <span>Server:</span>
            </div>
            <select
              value={serverPref}
              onChange={(e) => handleServerPrefChange(e.target.value)}
              className="text-[11px] font-bold text-slate-800 bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
              title="Select preferred server/label for this movie"
            >
              <option value="pixeldrain">Pixeldrain (Priority)</option>
              <option value="fsl">FSL Server</option>
              <option value="10gbps">10Gbps Server</option>
              <option value="hubcloud">HubCloud DD</option>
              <option value="gdflix">GDFlix</option>
            </select>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-[10px] text-slate-400 font-mono">#{movie.id}</span>

            <div className="flex items-center gap-1.5">
              {/* Quick fetch button for all qualities */}
              <button
                onClick={handleFetchLinks}
                disabled={isFetchingLinks}
                title={`Fetch all qualities using ${serverPref.toUpperCase()}`}
                className="text-[10px] bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 px-2 py-0.5 rounded-md border border-red-200 font-bold flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isFetchingLinks ? "animate-spin text-red-600" : ""}`}
                />
                <span>Fetch All Qualities</span>
              </button>

              {/* Priority Checkbox Toggle */}
              {onTogglePriority && (
                <button
                  onClick={() => onTogglePriority(movie.id, movie.priority ?? 0)}
                  title={isPriority ? "Remove from Priority" : "Set as Priority"}
                  className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border transition-all ${
                    isPriority
                      ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  <Star
                    className={`w-3 h-3 ${isPriority ? "fill-amber-500 text-amber-500" : "text-slate-400"}`}
                  />
                  <span>Pri</span>
                </button>
              )}
            </div>
          </div>

          {/* Links list grouped by quality */}
          <div className="space-y-1.5 min-h-[40px]">
            {parsedLinks.length > 0 ? (
              parsedLinks.map((qGroup, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <span>{qGroup.quality}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {qGroup.links.map((link, lIdx) => {
                      const t = link.text.toLowerCase();
                      const isPixel = t.includes("pixel");
                      const isFsl = t.includes("fsl") || t.includes("direct");
                      const is10G = t.includes("10gbps");

                      const badgeClass = isPixel
                        ? "bg-cyan-700 hover:bg-cyan-600 text-white"
                        : isFsl || is10G
                        ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                        : t.includes("batch") || t.includes("zip")
                        ? "bg-amber-600 hover:bg-amber-500 text-white"
                        : t.includes("hub")
                        ? "bg-blue-700 hover:bg-blue-600 text-white"
                        : "bg-indigo-700 hover:bg-indigo-600 text-white";

                      const isCopied = copiedLinkUrl === link.url;
                      const hasAlternatives = link.alternatives && link.alternatives.length > 1;

                      return (
                        <div
                          key={lIdx}
                          className={`inline-flex items-center rounded-lg shadow-xs overflow-hidden text-[10px] font-semibold transition-all ${badgeClass}`}
                        >
                          {/* Open Link */}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${link.text}: ${link.url}`}
                            className="px-2 py-1 flex items-center space-x-1 hover:brightness-110"
                          >
                            <span className="truncate max-w-[120px]">{link.text}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>

                          {/* Quick server switcher if multiple alternatives found */}
                          {hasAlternatives && (
                            <select
                              value={link.url}
                              onChange={(e) => {
                                const selectedAlt = link.alternatives?.find((a) => a.url === e.target.value);
                                if (selectedAlt) {
                                  handleSwitchServer(qGroup.quality, selectedAlt);
                                }
                              }}
                              className="bg-black/25 text-[9px] text-white font-medium border-l border-white/20 px-1 py-1 focus:outline-none cursor-pointer"
                              title="Switch server for this quality"
                            >
                              {link.alternatives!.map((alt, aIdx) => (
                                <option key={aIdx} value={alt.url} className="text-slate-800 bg-white">
                                  {alt.text}
                                </option>
                              ))}
                            </select>
                          )}

                          {/* Copy Link Button */}
                          <button
                            onClick={(e) => handleCopyLink(link.url, e)}
                            title="Copy link to clipboard"
                            className="px-1.5 py-1 border-l border-white/20 hover:bg-black/20 transition-colors cursor-pointer"
                          >
                            {isCopied ? (
                              <Check className="w-2.5 h-2.5 text-emerald-200" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 opacity-80 hover:opacity-100" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between text-xs text-slate-400 py-1">
                <span className="italic text-[11px]">No links yet</span>
                <button
                  onClick={handleFetchLinks}
                  disabled={isFetchingLinks}
                  className="text-[10px] bg-red-50 hover:bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 font-bold transition-colors cursor-pointer"
                >
                  {isFetchingLinks ? "Fetching..." : "Fetch All Qualities"}
                </button>
              </div>
            )}
          </div>

          {/* Manage Links trigger button */}
          <button
            onClick={() => setShowManageModal(true)}
            className="w-full text-center py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1 cursor-pointer"
          >
            <LinkIcon className="w-3 h-3 text-red-500" />
            <span>Select & Add Links</span>
          </button>
        </div>
      </div>

      {/* Manage & Add Links Modal for this specific Movie */}
      {showManageModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 line-clamp-1">{movie.title}</h3>
                <p className="text-xs text-slate-500">Manage, select, or add download links for all qualities</p>
              </div>
              <button
                onClick={() => setShowManageModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Server Preference on Modal */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-800">Server Priority / Label</div>
                <div className="text-[11px] text-slate-500">Default server used when fetching all qualities</div>
              </div>
              <select
                value={serverPref}
                onChange={(e) => handleServerPrefChange(e.target.value)}
                className="text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
              >
                <option value="pixeldrain">Pixeldrain (Priority)</option>
                <option value="fsl">FSL Server</option>
                <option value="10gbps">10Gbps Server</option>
                <option value="hubcloud">HubCloud DD</option>
                <option value="gdflix">GDFlix</option>
              </select>
            </div>

            {/* Current Links list with checkboxes and delete */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Existing Links ({parsedLinks.reduce((acc, g) => acc + g.links.length, 0)})</span>
                <button
                  onClick={handleFetchLinks}
                  disabled={isFetchingLinks}
                  className="bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingLinks ? "animate-spin" : ""}`} />
                  <span>Fetch All Qualities (Source)</span>
                </button>
              </div>

              {fetchNotice && (
                <div className="bg-amber-50 text-amber-800 border border-amber-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>{fetchNotice}</span>
                </div>
              )}

              {parsedLinks.length === 0 ? (
                <div className="text-xs text-slate-400 bg-slate-50 p-4 rounded-xl text-center italic">
                  No links for this movie yet. Click "Fetch All Qualities (Source)" or add one below.
                </div>
              ) : (
                <div className="space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {parsedLinks.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                        {group.quality}
                      </span>
                      <div className="space-y-1">
                        {group.links.map((link, lIdx) => (
                          <div
                            key={lIdx}
                            className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-slate-200 rounded-lg p-2 text-xs gap-2"
                          >
                            <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                              {/* Selection checkbox */}
                              <input
                                type="checkbox"
                                checked={link.selected !== false}
                                onChange={() => handleToggleLinkSelection(group.quality, link.url)}
                                title="Select or Deselect this link"
                                className="w-3.5 h-3.5 text-red-600 rounded border-slate-300 focus:ring-red-500 cursor-pointer"
                              />
                              <span className="font-semibold text-slate-800 shrink-0">{link.text}:</span>
                              <span className="text-slate-500 truncate font-mono text-[11px]">{link.url}</span>
                            </div>

                            <div className="flex items-center space-x-1 shrink-0 self-end sm:self-center">
                              {/* Switch server from alternatives if available */}
                              {link.alternatives && link.alternatives.length > 1 && (
                                <select
                                  value={link.url}
                                  onChange={(e) => {
                                    const selectedAlt = link.alternatives?.find((a) => a.url === e.target.value);
                                    if (selectedAlt) {
                                      handleSwitchServer(group.quality, selectedAlt);
                                    }
                                  }}
                                  className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 cursor-pointer mr-1"
                                  title="Switch to another server option"
                                >
                                  {link.alternatives.map((alt, aIdx) => (
                                    <option key={aIdx} value={alt.url}>
                                      {alt.text}
                                    </option>
                                  ))}
                                </select>
                              )}

                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 text-slate-400 hover:text-slate-700"
                                title="Open Link"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                              <button
                                onClick={(e) => handleCopyLink(link.url, e)}
                                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                                title="Copy Link"
                              >
                                {copiedLinkUrl === link.url ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => handleDeleteLink(group.quality, link.url)}
                                className="p-1 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                                title="Remove Link"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Custom Link Form */}
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-red-500" />
                <span>Add Custom Link</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Quality Selector */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Quality</label>
                  <select
                    value={editQuality}
                    onChange={(e) => setEditQuality(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
                  >
                    <option value="480P">480P</option>
                    <option value="720P">720P</option>
                    <option value="1080P">1080P</option>
                    <option value="4K / 2160P">4K / 2160P</option>
                    <option value="General">General</option>
                    <option value="CUSTOM">Custom Quality...</option>
                  </select>
                </div>

                {/* Server / Label Selector */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Server / Label</label>
                  <select
                    value={editServerChoice}
                    onChange={(e) => setEditServerChoice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer font-medium"
                  >
                    <option value="Pixeldrain">Pixeldrain (Priority)</option>
                    <option value="FSL Server">FSL Server (Direct R2)</option>
                    <option value="10Gbps Server">10Gbps Server (Fast)</option>
                    <option value="HubCloud DD">HubCloud DD</option>
                    <option value="GDFlix">GDFlix</option>
                    <option value="Google Drive">Google Drive</option>
                    <option value="Mega">Mega</option>
                    <option value="Watch Online">Watch Online / Stream</option>
                    <option value="CUSTOM">Custom Server...</option>
                  </select>
                </div>
              </div>

              {/* Custom Quality Input */}
              {editQuality === "CUSTOM" && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Custom Quality Name</label>
                  <input
                    type="text"
                    value={editCustomQuality}
                    onChange={(e) => setEditCustomQuality(e.target.value)}
                    placeholder="e.g. 720p 10-bit, Season 1 Batch"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              )}

              {/* Custom Server Input */}
              {editServerChoice === "CUSTOM" && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Custom Server / Label Name</label>
                  <input
                    type="text"
                    value={editCustomServer}
                    onChange={(e) => setEditCustomServer(e.target.value)}
                    placeholder="e.g. Terabox, Doodstream, Mediafire"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              )}

              {/* URL */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Download URL</label>
                <input
                  type="url"
                  value={editLinkUrl}
                  onChange={(e) => setEditLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManageModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={handleAddLink}
                  disabled={!editLinkUrl.trim() || isSavingLinks}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isSavingLinks ? "Saving..." : "Add Link"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

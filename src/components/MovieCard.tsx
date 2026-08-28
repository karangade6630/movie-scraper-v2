import React from "react";
import { Movie } from "../types";
import { Calendar, ExternalLink, Layers, Star } from "lucide-react";

interface MovieCardProps {
  movie: Movie;
  onTogglePriority?: (id: number, currentPriority: number) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onTogglePriority }) => {
  let parsedLinks: { quality: string; links: { text: string; url: string }[] }[] = [];
  try {
    parsedLinks = JSON.parse(movie.links);
  } catch (e) {
    console.error("Failed to parse links", e);
  }

  const isPriority = (movie.priority ?? 0) > 0;

  return (
    <div
      className={`bg-white border rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col group relative ${
        isPriority ? "ring-2 ring-amber-400 border-amber-300" : "border-slate-200"
      }`}
    >
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
            (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-80" />
        
        {/* Quality Badge */}
        <div className="absolute top-3 left-3 bg-red-600/90 backdrop-blur-md text-white font-bold text-xs px-2.5 py-1 rounded-lg shadow-md uppercase tracking-wider">
          {movie.quality}
        </div>

        {/* Page Badge (adjust right position if priority badge is active) */}
        <div className={`absolute ${isPriority ? 'top-8' : 'top-3'} right-3 bg-slate-900/80 backdrop-blur-md text-slate-200 font-medium text-xs px-2.5 py-1 rounded-lg border border-slate-700/50 flex items-center gap-1 transition-all`}>
          <Layers className="w-3 h-3 text-red-400" />
          <span>Pg {movie.page_num}</span>
        </div>

        {/* Title & Year overlay on bottom of poster */}
        <div className="absolute bottom-3 left-3 right-3">
          <div className="flex items-center space-x-1.5 text-xs text-slate-300 mb-1 font-medium">
            <Calendar className="w-3.5 h-3.5 text-red-400" />
            <span>{movie.release_year}</span>
          </div>
          <h3 className="text-white font-bold text-base leading-snug line-clamp-2 drop-shadow-md">
            {movie.title}
          </h3>
        </div>
      </div>

      {/* Footer / Actions */}
      <div className="p-4 bg-white flex flex-col gap-3 mt-auto border-t border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-mono truncate">ID: #{movie.id}</span>
          
          {/* Priority Checkbox / Star Toggle Button */}
          {onTogglePriority && (
            <button
              onClick={() => onTogglePriority(movie.id, movie.priority ?? 0)}
              title={isPriority ? "Remove from Priority" : "Set as Priority (Links come first)"}
              className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-all ${
                isPriority
                  ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                  : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              <input
                type="checkbox"
                checked={isPriority}
                onChange={() => {}} // handled by button onClick
                className="w-3.5 h-3.5 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer pointer-events-none"
              />
              <span className="cursor-pointer">Priority</span>
            </button>
          )}
        </div>

        <div className="space-y-2">
          {parsedLinks.length > 0 ? (
            parsedLinks.map((qGroup, idx) => (
              <div key={idx} className="space-y-1">
                <p className="text-[10px] font-bold text-slate-600 uppercase truncate">{qGroup.quality}</p>
                <div className="flex flex-wrap gap-1.5">
                  {qGroup.links.map((link, lIdx) => (
                    <a
                      key={lIdx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-1 bg-slate-900 hover:bg-red-600 text-white text-[9px] font-semibold px-2 py-1 rounded-lg transition-colors shadow-sm"
                    >
                      <span className="truncate max-w-[60px]">{link.text}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <span className="text-xs text-slate-400">No links</span>
          )}
        </div>
      </div>
    </div>
  );
};

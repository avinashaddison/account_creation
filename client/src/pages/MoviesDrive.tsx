import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Film, ExternalLink, AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";

type Movie = {
  title: string;
  image: string;
  link: string;
};

const RED = "#ff1a1a";
const RA = (a: number) => `rgba(255,26,26,${a})`;

export default function MoviesDrive() {
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [iframeLoading, setIframeLoading] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ movies: Movie[] }>({
    queryKey: ["/api/movies-drive"],
    staleTime: 5 * 60 * 1000,
  });

  const movies = data?.movies ?? [];

  function openMovie(movie: Movie) {
    setSelectedMovie(movie);
    setIframeLoading(true);
  }

  function closeMovie() {
    setSelectedMovie(null);
    setIframeLoading(false);
  }

  // ── POST VIEWER ──
  if (selectedMovie) {
    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 56px)", margin: "-28px" }}>
        {/* Viewer toolbar */}
        <div
          className="flex items-center gap-3 px-5 py-3 shrink-0 flex-wrap gap-y-2"
          style={{
            background: "linear-gradient(90deg, #0d0509 0%, #080410 100%)",
            borderBottom: `1px solid ${RA(0.20)}`,
          }}
        >
          <button
            onClick={closeMovie}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono font-bold uppercase tracking-widest transition-all"
            style={{
              background: RA(0.10),
              border: `1px solid ${RA(0.30)}`,
              color: RED,
              textShadow: `0 0 6px ${RA(0.4)}`,
            }}
            data-testid="button-back-movies"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            BACK
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Film className="w-3.5 h-3.5 shrink-0" style={{ color: RA(0.60) }} />
            <p
              className="text-[11px] font-mono truncate"
              style={{ color: "rgba(255,255,255,0.50)" }}
              title={selectedMovie.title}
            >
              {selectedMovie.title}
            </p>
          </div>

          {iframeLoading && (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: RA(0.50) }} />
          )}

          <a
            href={selectedMovie.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase tracking-widest shrink-0"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.40)",
            }}
            data-testid="button-open-external"
          >
            <ExternalLink className="w-3 h-3" />
            OPEN SITE
          </a>
        </div>

        {/* iframe */}
        <div className="flex-1 relative">
          {iframeLoading && (
            <div
              className="absolute inset-0 flex items-center justify-center z-10"
              style={{ background: "#07050a" }}
            >
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: RA(0.50) }} />
                <p className="text-[10px] font-mono tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
                  LOADING POST...
                </p>
              </div>
            </div>
          )}
          <iframe
            key={selectedMovie.link}
            src={selectedMovie.link}
            title={selectedMovie.title}
            className="w-full h-full border-0"
            onLoad={() => setIframeLoading(false)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            data-testid="iframe-movie-post"
          />
        </div>
      </div>
    );
  }

  // ── GRID VIEW ──
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded flex items-center justify-center shrink-0"
              style={{
                background: RA(0.15),
                border: `1px solid ${RA(0.40)}`,
                boxShadow: `0 0 14px ${RA(0.20)}`,
              }}
            >
              <Film className="w-4 h-4" style={{ color: RED, filter: `drop-shadow(0 0 5px ${RED})` }} />
            </div>
            <h1 className="text-[18px] font-mono font-bold tracking-tight" style={{ color: "#ffffff" }}>
              MoviesDrive Server
            </h1>
          </div>
          <p className="text-[11px] font-mono ml-10" style={{ color: "rgba(255,255,255,0.35)" }}>
            LIVE FEED › new1.moviesdrives.my
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded text-[11px] font-mono font-bold tracking-widest uppercase transition-all duration-150"
          style={{
            background: RA(0.10),
            border: `1px solid ${RA(0.30)}`,
            color: RED,
            textShadow: `0 0 6px ${RA(0.5)}`,
            opacity: isFetching ? 0.5 : 1,
          }}
          data-testid="button-refresh-movies"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "FETCHING..." : "REFRESH"}
        </button>
      </div>

      {/* Divider */}
      <div className="mb-6 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.30)}, transparent)` }} />

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="rounded overflow-hidden animate-pulse" data-testid={`skeleton-movie-${i}`}>
              <div className="w-full aspect-[2/3] rounded-md" style={{ background: "rgba(255,255,255,0.05)" }} />
              <div className="mt-2 h-3 rounded" style={{ background: "rgba(255,255,255,0.05)" }} />
              <div className="mt-1 h-3 w-2/3 rounded" style={{ background: "rgba(255,255,255,0.03)" }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div
          className="flex items-start gap-3 p-5 rounded"
          style={{ background: RA(0.07), border: `1px solid ${RA(0.25)}` }}
          data-testid="error-movies"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: RED }} />
          <div>
            <p className="text-[13px] font-mono font-bold" style={{ color: RED }}>
              FETCH FAILED
            </p>
            <p className="text-[11px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.40)" }}>
              Could not connect to MoviesDrive. Try refreshing.
            </p>
          </div>
        </div>
      )}

      {/* Movie grid */}
      {!isLoading && !isError && movies.length > 0 && (
        <>
          <p className="text-[10px] font-mono mb-4 tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            {movies.length} TITLES FOUND
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {movies.map((movie, idx) => (
              <div
                key={idx}
                className="group cursor-pointer"
                onClick={() => openMovie(movie)}
                data-testid={`card-movie-${idx}`}
              >
                <div
                  className="rounded-md overflow-hidden relative"
                  style={{
                    border: "1px solid rgba(255,255,255,0.07)",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = RA(0.45);
                    (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${RA(0.15)}`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                  }}
                >
                  {/* Poster */}
                  <div className="w-full aspect-[2/3] relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <img
                      src={movie.image}
                      alt={movie.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const t = e.currentTarget;
                        t.style.display = "none";
                        (t.parentElement as HTMLElement).style.display = "flex";
                        (t.parentElement as HTMLElement).style.alignItems = "center";
                        (t.parentElement as HTMLElement).style.justifyContent = "center";
                      }}
                    />
                    {/* Hover overlay */}
                    <div
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.55)" }}
                    >
                      <div
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase tracking-widest"
                        style={{
                          background: RA(0.20),
                          border: `1px solid ${RA(0.50)}`,
                          color: RED,
                          textShadow: `0 0 6px ${RA(0.5)}`,
                        }}
                      >
                        <Film className="w-3 h-3" />
                        VIEW POST
                      </div>
                    </div>
                  </div>
                </div>

                {/* Title */}
                <p
                  className="mt-2 text-[11px] font-mono leading-snug line-clamp-2"
                  style={{ color: "rgba(255,255,255,0.65)" }}
                  data-testid={`text-movie-title-${idx}`}
                >
                  {movie.title}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty */}
      {!isLoading && !isError && movies.length === 0 && (
        <div className="text-center py-16">
          <Film className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
          <p className="text-[12px] font-mono" style={{ color: "rgba(255,255,255,0.30)" }}>
            NO MOVIES FOUND
          </p>
        </div>
      )}
    </div>
  );
}

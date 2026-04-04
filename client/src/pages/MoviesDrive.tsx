import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Film, ExternalLink, AlertTriangle, ArrowLeft,
  Loader2, Calendar, Download, Star, Globe, Clapperboard,
  Play,
} from "lucide-react";

type Movie = { title: string; image: string; link: string };

type PostData = {
  title: string;
  date: string;
  categories: string[];
  poster: string;
  storyline: string;
  screenshots: string[];
  downloads: { label: string; url: string }[];
  youtubeId: string;
  info: {
    imdb: string; genre: string; director: string; writer: string;
    stars: string; language: string; quality: string; format: string;
    season: string; episodeSize: string; releasedYear: string; seriesName: string;
  };
};

const RED = "#e63232";
const RA = (a: number) => `rgba(230,50,50,${a})`;
const DIM = (a: number) => `rgba(255,255,255,${a})`;
const DARK = (a: number) => `rgba(0,0,0,${a})`;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-0 text-[12px] font-mono" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div
        className="shrink-0 px-3 py-2 font-bold uppercase tracking-wide text-[10px]"
        style={{ background: "rgba(255,255,255,0.04)", color: DIM(0.45), minWidth: 110 }}
      >
        {label}
      </div>
      <div className="px-3 py-2" style={{ color: DIM(0.85) }}>{value}</div>
    </div>
  );
}

function DownloadBtn({ label, url, idx }: { label: string; url: string; idx: number }) {
  const qualityMatch = label.match(/\b(4K|2160p|1080p|720p|480p|360p|HDRip|BluRay|WEB-?DL|HEVC)\b/i);
  const sizeMatch = label.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB))\b/i);
  const quality = qualityMatch ? qualityMatch[0].toUpperCase() : null;
  const size = sizeMatch ? sizeMatch[0] : null;

  const qualityColor: Record<string, string> = {
    "4K": "#a78bfa", "2160P": "#a78bfa",
    "1080P": "#34d399", "BLURAY": "#34d399",
    "720P": "#60a5fa", "WEB-DL": "#60a5fa",
    "480P": "#fbbf24", "360P": "#fbbf24",
    "HDRIP": "#fb923c", "HEVC": "#f472b6",
  };
  const qColor = quality ? (qualityColor[quality] || RED) : RED;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`link-download-${idx}`}
      className="flex items-center gap-3 px-4 py-3 rounded-md w-full"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
        transition: "all 0.15s",
        textDecoration: "none",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = RA(0.50);
        (e.currentTarget as HTMLAnchorElement).style.background = RA(0.07);
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.10)";
        (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.04)";
      }}
    >
      <div
        className="shrink-0 flex items-center justify-center rounded text-[9px] font-mono font-black tracking-widest"
        style={{ width: 52, height: 26, background: `${qColor}22`, border: `1px solid ${qColor}66`, color: qColor }}
      >
        {quality || "LINK"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-mono leading-snug truncate" style={{ color: DIM(0.75) }}>
          {label}
        </p>
        {size && (
          <p className="text-[10px] font-mono mt-0.5" style={{ color: DIM(0.35) }}>{size}</p>
        )}
      </div>
      <Download className="shrink-0 w-3.5 h-3.5" style={{ color: DIM(0.30) }} />
    </a>
  );
}

function PostView({ movie, onBack }: { movie: Movie; onBack: () => void }) {
  const [imgError, setImgError] = useState(false);

  const { data, isLoading, isError } = useQuery<PostData>({
    queryKey: ["/api/movies-drive/post", movie.link],
    queryFn: () =>
      fetch(`/api/movies-drive/post?url=${encodeURIComponent(movie.link)}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const posterSrc = data?.poster || movie.image;
  const infoFields = data ? [
    { label: "IMDB", value: data.info.imdb, icon: <Star className="w-3 h-3" /> },
    { label: "Name", value: data.info.seriesName },
    { label: "Season", value: data.info.season },
    { label: "Year", value: data.info.releasedYear },
    { label: "Genre", value: data.info.genre, icon: <Clapperboard className="w-3 h-3" /> },
    { label: "Director", value: data.info.director },
    { label: "Writer", value: data.info.writer },
    { label: "Stars", value: data.info.stars },
    { label: "Language", value: data.info.language, icon: <Globe className="w-3 h-3" /> },
    { label: "Quality", value: data.info.quality },
    { label: "Ep. Size", value: data.info.episodeSize },
    { label: "Format", value: data.info.format },
  ].filter(f => f.value) : [];

  return (
    <div>
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap gap-y-2">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono font-bold uppercase tracking-widest"
          style={{ background: RA(0.10), border: `1px solid ${RA(0.35)}`, color: RED }}
          data-testid="button-back-movies"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> BACK
        </button>
        <a
          href={movie.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-widest"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: DIM(0.40) }}
          data-testid="button-open-site"
        >
          <ExternalLink className="w-3 h-3" /> OPEN SITE
        </a>
        {data?.date && (
          <span className="flex items-center gap-1.5 text-[10px] font-mono ml-auto" style={{ color: DIM(0.30) }}>
            <Calendar className="w-3 h-3" /> {data.date}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col items-center py-28 gap-4">
          <Loader2 className="w-7 h-7 animate-spin" style={{ color: RA(0.50) }} />
          <p className="text-[10px] font-mono tracking-widest" style={{ color: DIM(0.25) }}>LOADING POST...</p>
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-3 p-5 rounded" style={{ background: RA(0.07), border: `1px solid ${RA(0.25)}` }}>
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: RED }} />
          <div>
            <p className="text-[13px] font-mono font-bold" style={{ color: RED }}>FETCH FAILED</p>
            <p className="text-[11px] font-mono mt-1" style={{ color: DIM(0.40) }}>
              Could not load post. Try opening the site directly.
            </p>
          </div>
        </div>
      )}

      {data && !isLoading && (
        <div>
          {/* ── Categories ── */}
          {data.categories.length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {data.categories.map(cat => (
                <span
                  key={cat}
                  className="text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 rounded-sm uppercase"
                  style={{ background: RA(0.12), border: `1px solid ${RA(0.30)}`, color: RED }}
                >
                  {cat}
                </span>
              ))}
            </div>
          )}

          {/* ── Title ── */}
          <h1 className="text-[17px] font-mono font-bold leading-snug mb-5" style={{ color: "#ffffff" }}>
            {data.title || movie.title}
          </h1>

          {/* ── Poster + Info Table ── */}
          <div
            className="rounded-md overflow-hidden mb-7"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex flex-wrap">
              {/* Poster */}
              {posterSrc && !imgError && (
                <div className="shrink-0" style={{ width: 160 }}>
                  <img
                    src={posterSrc}
                    alt={data.title || movie.title}
                    className="w-full h-full object-cover"
                    style={{ minHeight: 200, display: "block" }}
                    onError={() => setImgError(true)}
                    data-testid="img-post-poster"
                  />
                </div>
              )}
              {/* Info rows */}
              {infoFields.length > 0 && (
                <div className="flex-1 min-w-[200px] divide-y" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                  {infoFields.map(f => (
                    <InfoRow key={f.label} label={f.label} value={f.value} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Storyline ── */}
          {data.storyline && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-4 w-1 rounded-full" style={{ background: RED }} />
                <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: "#fff" }}>
                  Storyline
                </p>
              </div>
              <p
                className="text-[12px] font-mono leading-relaxed px-4 py-3 rounded-md"
                style={{
                  color: DIM(0.65),
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                {data.storyline}
              </p>
            </div>
          )}

          {/* ── Download Links ── */}
          {data.downloads.length > 0 && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full" style={{ background: RED }} />
                <Download className="w-3.5 h-3.5" style={{ color: RED }} />
                <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: "#fff" }}>
                  Download Links
                </p>
                <span
                  className="text-[9px] font-mono px-2 py-0.5 rounded"
                  style={{ background: RA(0.12), border: `1px solid ${RA(0.25)}`, color: RED }}
                >
                  {data.downloads.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {data.downloads.map((dl, i) => (
                  <DownloadBtn key={i} label={dl.label} url={dl.url} idx={i} />
                ))}
              </div>
            </div>
          )}

          {/* ── YouTube Trailer ── */}
          {data.youtubeId && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full" style={{ background: RED }} />
                <Play className="w-3.5 h-3.5" style={{ color: RED }} />
                <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: "#fff" }}>
                  Trailer
                </p>
              </div>
              <div
                className="rounded-md overflow-hidden"
                style={{ border: `1px solid ${RA(0.20)}`, maxWidth: 640, position: "relative", paddingBottom: "56.25%" }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${data.youtubeId}`}
                  className="absolute inset-0 w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Trailer"
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                  data-testid="iframe-trailer"
                />
              </div>
            </div>
          )}

          {/* ── Screenshots ── */}
          {data.screenshots.length > 0 && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full" style={{ background: RED }} />
                <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: "#fff" }}>
                  Screenshots
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {data.screenshots.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    <img
                      src={src}
                      alt={`Screenshot ${i + 1}`}
                      className="w-full rounded object-cover"
                      style={{ border: "1px solid rgba(255,255,255,0.07)", aspectRatio: "16/9" }}
                      loading="lazy"
                      data-testid={`img-screenshot-${i}`}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════
//  GRID VIEW
// ════════════════════════════════════════════
export default function MoviesDrive() {
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ movies: Movie[] }>({
    queryKey: ["/api/movies-drive"],
    staleTime: 5 * 60 * 1000,
  });

  const movies = data?.movies ?? [];

  if (selectedMovie) {
    return <PostView movie={selectedMovie} onBack={() => setSelectedMovie(null)} />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded flex items-center justify-center shrink-0"
              style={{ background: RA(0.15), border: `1px solid ${RA(0.40)}`, boxShadow: `0 0 14px ${RA(0.20)}` }}
            >
              <Film className="w-4 h-4" style={{ color: RED, filter: `drop-shadow(0 0 5px ${RED})` }} />
            </div>
            <h1 className="text-[18px] font-mono font-bold tracking-tight" style={{ color: "#ffffff" }}>
              MoviesDrive Server
            </h1>
          </div>
          <p className="text-[11px] font-mono ml-10" style={{ color: DIM(0.35) }}>
            LIVE FEED › new1.moviesdrives.my
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded text-[11px] font-mono font-bold tracking-widest uppercase"
          style={{
            background: RA(0.10), border: `1px solid ${RA(0.30)}`,
            color: RED, textShadow: `0 0 6px ${RA(0.5)}`,
            opacity: isFetching ? 0.5 : 1,
          }}
          data-testid="button-refresh-movies"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "FETCHING..." : "REFRESH"}
        </button>
      </div>

      <div className="mb-6 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.30)}, transparent)` }} />

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="w-full aspect-[2/3] rounded-md" style={{ background: DIM(0.05) }} />
              <div className="mt-2 h-3 rounded" style={{ background: DIM(0.05) }} />
              <div className="mt-1 h-3 w-2/3 rounded" style={{ background: DIM(0.03) }} />
            </div>
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-start gap-3 p-5 rounded" style={{ background: RA(0.07), border: `1px solid ${RA(0.25)}` }} data-testid="error-movies">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: RED }} />
          <div>
            <p className="text-[13px] font-mono font-bold" style={{ color: RED }}>FETCH FAILED</p>
            <p className="text-[11px] font-mono mt-1" style={{ color: DIM(0.40) }}>
              Could not connect to MoviesDrive. Try refreshing.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && movies.length > 0 && (
        <>
          <p className="text-[10px] font-mono mb-4 tracking-widest" style={{ color: DIM(0.25) }}>
            {movies.length} TITLES FOUND
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {movies.map((movie, idx) => (
              <div
                key={idx}
                className="group cursor-pointer"
                onClick={() => setSelectedMovie(movie)}
                data-testid={`card-movie-${idx}`}
              >
                <div
                  className="rounded-md overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.07)", transition: "border-color 0.15s, box-shadow 0.15s" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = RA(0.45);
                    (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${RA(0.15)}`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                  }}
                >
                  <div className="w-full aspect-[2/3] relative overflow-hidden" style={{ background: DIM(0.04) }}>
                    <img
                      src={movie.image} alt={movie.title}
                      className="w-full h-full object-cover" loading="lazy"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.60)" }}
                    >
                      <div
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase tracking-widest"
                        style={{ background: RA(0.20), border: `1px solid ${RA(0.50)}`, color: RED }}
                      >
                        <Film className="w-3 h-3" /> VIEW
                      </div>
                    </div>
                  </div>
                </div>
                <p
                  className="mt-2 text-[11px] font-mono leading-snug line-clamp-2"
                  style={{ color: DIM(0.65) }}
                  data-testid={`text-movie-title-${idx}`}
                >
                  {movie.title}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {!isLoading && !isError && movies.length === 0 && (
        <div className="text-center py-16">
          <Film className="w-10 h-10 mx-auto mb-3" style={{ color: DIM(0.15) }} />
          <p className="text-[12px] font-mono" style={{ color: DIM(0.30) }}>NO MOVIES FOUND</p>
        </div>
      )}
    </div>
  );
}

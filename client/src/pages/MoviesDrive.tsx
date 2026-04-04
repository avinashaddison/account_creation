import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Film, ExternalLink, AlertTriangle, ArrowLeft,
  Loader2, Calendar, Tag, Download, Star, Clapperboard, Globe,
  MonitorPlay, FileVideo, User, Pen,
} from "lucide-react";

type Movie = { title: string; image: string; link: string };

type PostData = {
  title: string;
  date: string;
  categories: string[];
  poster: string;
  storyline: string;
  screenshots: string[];
  downloads: { label: string; size: string; url: string }[];
  youtubeId: string;
  info: {
    imdb: string; genre: string; director: string; writer: string;
    stars: string; language: string; quality: string; format: string;
  };
};

const RED = "#ff1a1a";
const RA = (a: number) => `rgba(255,26,26,${a})`;
const DIM = (a: number) => `rgba(255,255,255,${a})`;

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: RA(0.55) }} />
      <span className="text-[11px] font-mono shrink-0" style={{ color: DIM(0.35), minWidth: 72 }}>{label}</span>
      <span className="text-[11px] font-mono" style={{ color: DIM(0.80) }}>{value}</span>
    </div>
  );
}

function PostView({ movie, onBack }: { movie: Movie; onBack: () => void }) {
  const { data, isLoading, isError } = useQuery<PostData>({
    queryKey: ["/api/movies-drive/post", movie.link],
    queryFn: () => fetch(`/api/movies-drive/post?url=${encodeURIComponent(movie.link)}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  return (
    <div>
      {/* Back bar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap gap-y-2">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono font-bold uppercase tracking-widest transition-all"
          style={{ background: RA(0.10), border: `1px solid ${RA(0.30)}`, color: RED, textShadow: `0 0 6px ${RA(0.4)}` }}
          data-testid="button-back-movies"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> BACK
        </button>
        <a
          href={movie.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-widest"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: DIM(0.35) }}
          data-testid="button-open-site"
        >
          <ExternalLink className="w-3 h-3" /> OPEN SITE
        </a>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 className="w-7 h-7 animate-spin" style={{ color: RA(0.50) }} />
          <p className="text-[10px] font-mono tracking-widest" style={{ color: DIM(0.25) }}>FETCHING POST DATA...</p>
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-3 p-5 rounded" style={{ background: RA(0.07), border: `1px solid ${RA(0.25)}` }}>
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: RED }} />
          <div>
            <p className="text-[13px] font-mono font-bold" style={{ color: RED }}>FETCH FAILED</p>
            <p className="text-[11px] font-mono mt-1" style={{ color: DIM(0.40) }}>Could not load post data.</p>
          </div>
        </div>
      )}

      {data && !isLoading && (
        <div className="max-w-[1100px]">
          {/* Title */}
          <h1 className="text-[17px] font-mono font-bold leading-snug mb-3" style={{ color: "#ffffff" }}>
            {data.title || movie.title}
          </h1>

          {/* Meta row */}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            {data.date && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: DIM(0.35) }}>
                <Calendar className="w-3 h-3" /> {data.date}
              </span>
            )}
            {data.categories.map(cat => (
              <span
                key={cat}
                className="text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 rounded-sm"
                style={{ background: RA(0.12), border: `1px solid ${RA(0.30)}`, color: RED }}
              >
                {cat}
              </span>
            ))}
          </div>

          <div className="flex gap-6 flex-wrap">
            {/* Left: Poster */}
            {data.poster && (
              <div className="shrink-0">
                <img
                  src={data.poster}
                  alt={data.title}
                  className="rounded-md"
                  style={{ width: 200, border: `1px solid ${RA(0.30)}`, boxShadow: `0 0 30px ${RA(0.15)}` }}
                  data-testid="img-post-poster"
                />
              </div>
            )}

            {/* Right: Info */}
            <div className="flex-1 min-w-[260px]">
              <div
                className="rounded-md px-4 py-1 mb-4"
                style={{ background: "rgba(0,0,0,0.40)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <InfoRow icon={Star} label="IMDB" value={data.info.imdb} />
                <InfoRow icon={Tag} label="Genre" value={data.info.genre} />
                <InfoRow icon={User} label="Director" value={data.info.director} />
                <InfoRow icon={Pen} label="Writer" value={data.info.writer} />
                <InfoRow icon={Clapperboard} label="Stars" value={data.info.stars} />
                <InfoRow icon={Globe} label="Language" value={data.info.language} />
                <InfoRow icon={MonitorPlay} label="Quality" value={data.info.quality} />
                <InfoRow icon={FileVideo} label="Format" value={data.info.format} />
              </div>

              {/* Storyline */}
              {data.storyline && (
                <div
                  className="rounded-md p-4"
                  style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <p className="text-[10px] font-mono font-bold tracking-widest mb-2" style={{ color: RA(0.70) }}>
                    STORYLINE
                  </p>
                  <p className="text-[12px] font-mono leading-relaxed" style={{ color: DIM(0.60) }}>
                    {data.storyline}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Download Links */}
          {data.downloads.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-4">
                <Download className="w-4 h-4" style={{ color: RED }} />
                <h2 className="text-[13px] font-mono font-bold tracking-widest" style={{ color: "#ffffff" }}>
                  DOWNLOAD LINKS
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {data.downloads.map((dl, i) => (
                  <a
                    key={i}
                    href={dl.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 px-4 py-3 rounded-md transition-all"
                    style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.09)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLAnchorElement).style.borderColor = RA(0.40);
                      (e.currentTarget as HTMLAnchorElement).style.background = RA(0.10);
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.09)";
                      (e.currentTarget as HTMLAnchorElement).style.background = "rgba(0,0,0,0.45)";
                    }}
                    data-testid={`link-download-${i}`}
                  >
                    <Download className="w-3.5 h-3.5 shrink-0 group-hover:text-red-400 transition-colors" style={{ color: RA(0.50) }} />
                    <span className="flex-1 text-[11px] font-mono leading-snug" style={{ color: DIM(0.65) }}>
                      {dl.size}
                    </span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: RA(0.60) }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* YouTube Trailer */}
          {data.youtubeId && (
            <div className="mt-8">
              <p className="text-[10px] font-mono font-bold tracking-widest mb-3" style={{ color: RA(0.70) }}>
                TRAILER
              </p>
              <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${RA(0.20)}`, maxWidth: 640 }}>
                <div className="relative" style={{ paddingBottom: "56.25%" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${data.youtubeId}`}
                    className="absolute inset-0 w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Trailer"
                    data-testid="iframe-trailer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Screenshots */}
          {data.screenshots.length > 0 && (
            <div className="mt-8">
              <p className="text-[10px] font-mono font-bold tracking-widest mb-3" style={{ color: RA(0.70) }}>
                SCREENSHOTS
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {data.screenshots.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    <img
                      src={src}
                      alt={`Screenshot ${i + 1}`}
                      className="w-full rounded-sm object-cover"
                      style={{ border: "1px solid rgba(255,255,255,0.08)", aspectRatio: "16/9" }}
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
          style={{ background: RA(0.10), border: `1px solid ${RA(0.30)}`, color: RED, textShadow: `0 0 6px ${RA(0.5)}`, opacity: isFetching ? 0.5 : 1 }}
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
            <p className="text-[11px] font-mono mt-1" style={{ color: DIM(0.40) }}>Could not connect to MoviesDrive. Try refreshing.</p>
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
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = RA(0.45); (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${RA(0.15)}`; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
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
                        style={{ background: RA(0.20), border: `1px solid ${RA(0.50)}`, color: RED, textShadow: `0 0 6px ${RA(0.5)}` }}
                      >
                        <Film className="w-3 h-3" /> VIEW
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-mono leading-snug line-clamp-2" style={{ color: DIM(0.65) }} data-testid={`text-movie-title-${idx}`}>
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

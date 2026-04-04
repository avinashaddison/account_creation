import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Film, ExternalLink, AlertTriangle, ArrowLeft,
  Loader2, Calendar, Download,
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

function PostView({ movie, onBack }: { movie: Movie; onBack: () => void }) {
  const { data, isLoading, isError } = useQuery<PostData>({
    queryKey: ["/api/movies-drive/post", movie.link],
    queryFn: () =>
      fetch(`/api/movies-drive/post?url=${encodeURIComponent(movie.link)}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const posterSrc = data?.poster || movie.image;

  const infoItems = data ? [
    data.info.imdb      && { icon: "⭐", label: "iMDB Rating",  value: data.info.imdb },
    data.info.seriesName&& { icon: "🎬", label: "Movie Name",   value: data.info.seriesName },
    data.info.season    && { icon: "📺", label: "Season",       value: data.info.season },
    data.info.releasedYear && { icon: "📅", label: "Year",      value: data.info.releasedYear },
    data.info.genre     && { icon: "🎭", label: "Genre",        value: data.info.genre },
    data.info.director  && { icon: "🎥", label: "Director",     value: data.info.director },
    data.info.writer    && { icon: "✍️", label: "Writer",       value: data.info.writer },
    data.info.stars     && { icon: "🌟", label: "Stars",        value: data.info.stars },
    data.info.language  && { icon: "🗣️", label: "Language",     value: data.info.language },
    data.info.quality   && { icon: "🎵", label: "Quality",      value: data.info.quality },
    data.info.episodeSize && { icon: "📦", label: "Ep. Size",   value: data.info.episodeSize },
    data.info.format    && { icon: "🎙️", label: "Format",      value: data.info.format },
  ].filter(Boolean) as { icon: string; label: string; value: string }[] : [];

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
            <p className="text-[11px] font-mono mt-1" style={{ color: DIM(0.40) }}>Could not load post.</p>
          </div>
        </div>
      )}

      {data && !isLoading && (
        <div className="max-w-2xl">

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
          <h1 className="text-[15px] font-mono font-bold leading-snug mb-5" style={{ color: "#ffffff" }}>
            {data.title || movie.title}
          </h1>

          {/* ── Poster (centered, prominent) ── */}
          {posterSrc && (
            <div className="flex justify-center mb-5">
              <img
                src={posterSrc}
                alt={data.title || movie.title}
                className="rounded-md object-cover"
                style={{
                  maxWidth: 260,
                  width: "100%",
                  border: `1px solid ${RA(0.30)}`,
                  boxShadow: `0 4px 32px ${RA(0.15)}`,
                }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                data-testid="img-post-poster"
              />
            </div>
          )}

          {/* ── Divider ── */}
          <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.35)}, transparent)` }} />

          {/* ── Movie Info (emoji list) ── */}
          {infoItems.length > 0 && (
            <div className="mb-5 space-y-1.5">
              <p
                className="text-[11px] font-mono font-bold tracking-widest mb-3 uppercase"
                style={{ color: RED }}
              >
                Movie / Film Info
              </p>
              {infoItems.map(item => (
                <div key={item.label} className="flex gap-2 text-[12px] font-mono leading-relaxed">
                  <span className="shrink-0">{item.icon}</span>
                  <span style={{ color: DIM(0.45), minWidth: 90 }}>{item.label}:</span>
                  <span style={{ color: DIM(0.85) }}>{item.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Divider ── */}
          <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />

          {/* ── Storyline ── */}
          {data.storyline && (
            <>
              <div className="mb-5">
                <p className="text-[11px] font-mono font-bold tracking-widest mb-3 uppercase" style={{ color: RED }}>
                  ♦ Storyline
                </p>
                <p className="text-[12px] font-mono leading-relaxed" style={{ color: DIM(0.70) }}>
                  {data.storyline}
                </p>
              </div>
              <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
            </>
          )}

          {/* ── Screenshots ── */}
          {data.screenshots.length > 0 && (
            <>
              <div className="mb-5">
                <p className="text-[11px] font-mono font-bold tracking-widest mb-3 uppercase" style={{ color: RED }}>
                  🖼️ Screen-Shots
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
              <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
            </>
          )}

          {/* ── Download Links ── */}
          {data.downloads.length > 0 && (
            <>
              <div className="mb-5">
                {/* Header */}
                <div className="text-center mb-4">
                  <p className="text-[11px] font-mono font-bold" style={{ color: DIM(0.50) }}>
                    {`<<<<< ${data.title || movie.title} >>>>>`}
                  </p>
                  <p className="text-[12px] font-mono font-bold mt-1 tracking-widest" style={{ color: RED }}>
                    -: DOWNLOAD LINKS :-
                  </p>
                </div>

                {/* Link pairs: description + button */}
                <div className="space-y-4">
                  {data.downloads.map((dl, i) => (
                    <div key={i}>
                      {/* Description label */}
                      <p
                        className="text-[11px] font-mono mb-2 leading-snug"
                        style={{ color: DIM(0.55) }}
                      >
                        {data.title} {dl.label}
                      </p>
                      {/* Download button */}
                      <a
                        href={dl.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`link-download-${i}`}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded font-mono font-bold text-[12px] tracking-wide"
                        style={{
                          background: RA(0.18),
                          border: `1px solid ${RA(0.45)}`,
                          color: RED,
                          textDecoration: "none",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLAnchorElement).style.background = RA(0.30);
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLAnchorElement).style.background = RA(0.18);
                        }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        {dl.label}
                      </a>
                      {i < data.downloads.length - 1 && (
                        <div className="mt-4 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                      )}
                    </div>
                  ))}
                </div>

                {/* Note */}
                <div
                  className="mt-5 px-4 py-3 rounded text-[11px] font-mono"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: DIM(0.40) }}
                >
                  Note: If the link is expired, open the original site and report it.
                </div>
              </div>
              <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
            </>
          )}

          {/* ── YouTube Trailer ── */}
          {data.youtubeId && (
            <div className="mb-5">
              <p className="text-[11px] font-mono font-bold tracking-widest mb-3 uppercase" style={{ color: RED }}>
                Trailer
              </p>
              <div
                className="rounded-md overflow-hidden w-full"
                style={{ border: `1px solid ${RA(0.20)}`, position: "relative", paddingBottom: "56.25%" }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${data.youtubeId}`}
                  className="border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Trailer"
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                  data-testid="iframe-trailer"
                />
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
  const RA = (a: number) => `rgba(230,50,50,${a})`;
  const DIM = (a: number) => `rgba(255,255,255,${a})`;
  const RED = "#e63232";

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

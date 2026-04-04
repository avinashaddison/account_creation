import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Film, ExternalLink, AlertTriangle, ArrowLeft,
  Loader2, Calendar, Download, Copy, Check, Link2,
} from "lucide-react";

type Movie = { title: string; image: string; link: string };

type PostData = {
  title: string;
  date: string;
  categories: string[];
  poster: string;
  storyline: string;
  screenshots: string[];
  downloads: { label: string; url: string; directUrl?: string }[];
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

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      title={label || "Copy"}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wide shrink-0"
      style={{
        background: copied ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.05)",
        border: copied ? "1px solid rgba(52,211,153,0.35)" : "1px solid rgba(255,255,255,0.12)",
        color: copied ? "#34d399" : DIM(0.45),
        transition: "all 0.2s",
      }}
      data-testid="button-copy"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : (label || "Copy")}
    </button>
  );
}

function SectionHeader({ title, copyText }: { title: string; copyText?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full shrink-0" style={{ background: RED }} />
        <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: "#fff" }}>
          {title}
        </p>
      </div>
      {copyText && <CopyBtn text={copyText} />}
    </div>
  );
}

function PostView({ movie, onBack }: { movie: Movie; onBack: () => void }) {
  const { data, isLoading, isError } = useQuery<PostData>({
    queryKey: ["/api/movies-drive/post", movie.link],
    queryFn: () =>
      fetch(`/api/movies-drive/post?url=${encodeURIComponent(movie.link)}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const posterSrc = data?.poster || movie.image;

  const infoItems = data ? [
    { label: "iMDB Rating",  value: data.info.imdb },
    { label: "Movie Name",   value: data.info.seriesName },
    { label: "Season",       value: data.info.season },
    { label: "Year",         value: data.info.releasedYear },
    { label: "Genre",        value: data.info.genre },
    { label: "Director",     value: data.info.director },
    { label: "Writer",       value: data.info.writer },
    { label: "Stars",        value: data.info.stars },
    { label: "Language",     value: data.info.language },
    { label: "Quality",      value: data.info.quality },
    { label: "Ep. Size",     value: data.info.episodeSize },
    { label: "Format",       value: data.info.format },
  ].filter(f => f.value) : [];

  const infoText = infoItems.map(f => `${f.label}: ${f.value}`).join("\n");

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
          <div className="flex items-start justify-between gap-3 mb-5">
            <h1 className="text-[15px] font-mono font-bold leading-snug" style={{ color: "#ffffff" }}>
              {data.title || movie.title}
            </h1>
            <CopyBtn text={data.title || movie.title} label="Title" />
          </div>

          {/* ── Poster ── */}
          {posterSrc && (
            <div className="flex justify-center mb-5">
              <img
                src={posterSrc}
                alt={data.title || movie.title}
                className="rounded-md object-cover"
                style={{
                  maxWidth: 280,
                  width: "100%",
                  border: `1px solid ${RA(0.30)}`,
                  boxShadow: `0 4px 32px ${RA(0.18)}`,
                }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                data-testid="img-post-poster"
              />
            </div>
          )}

          <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.35)}, transparent)` }} />

          {/* ── Movie/Film Info ── */}
          {infoItems.length > 0 && (
            <div className="mb-5">
              <SectionHeader title="Movie / Film Info" copyText={infoText} />
              <div
                className="rounded-md overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {infoItems.map((item, i) => (
                  <div
                    key={item.label}
                    className="flex gap-0"
                    style={{
                      borderBottom: i < infoItems.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                    }}
                  >
                    <div
                      className="shrink-0 px-4 py-2.5 text-[10px] font-mono font-bold uppercase tracking-wide"
                      style={{ background: "rgba(255,255,255,0.03)", color: DIM(0.40), minWidth: 100 }}
                    >
                      {item.label}
                    </div>
                    <div
                      className="px-4 py-2.5 text-[12px] font-mono flex-1"
                      style={{ color: DIM(0.80) }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />

          {/* ── Storyline ── */}
          {data.storyline && (
            <>
              <div className="mb-5">
                <SectionHeader title="Storyline" copyText={data.storyline} />
                <div
                  className="px-4 py-3.5 rounded-md text-[12px] font-mono leading-relaxed"
                  style={{
                    background: "rgba(255,255,255,0.025)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: DIM(0.70),
                  }}
                >
                  {data.storyline}
                </div>
              </div>
              <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
            </>
          )}

          {/* ── Screenshots ── */}
          {data.screenshots.length > 0 && (
            <>
              <div className="mb-5">
                <SectionHeader
                  title={`Screenshots (${data.screenshots.length})`}
                  copyText={data.screenshots.join("\n")}
                />
                <div className="grid grid-cols-2 gap-3">
                  {data.screenshots.map((src, i) => (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block relative rounded-md overflow-hidden"
                      style={{ border: "1px solid rgba(255,255,255,0.09)" }}
                    >
                      <img
                        src={src}
                        alt={`Screenshot ${i + 1}`}
                        className="w-full object-cover"
                        style={{ aspectRatio: "16/9", display: "block" }}
                        loading="lazy"
                        data-testid={`img-screenshot-${i}`}
                      />
                      <div
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(0,0,0,0.50)" }}
                      >
                        <ExternalLink className="w-5 h-5" style={{ color: "#fff" }} />
                      </div>
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
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 rounded-full shrink-0" style={{ background: RED }} />
                    <Download className="w-3.5 h-3.5" style={{ color: RED }} />
                    <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: "#fff" }}>
                      Download Links
                    </p>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: RA(0.12), border: `1px solid ${RA(0.25)}`, color: RED }}
                    >
                      {data.downloads.length}
                    </span>
                  </div>
                  <CopyBtn
                    text={data.downloads.map(d => `${d.label}: ${d.directUrl || d.url}`).join("\n")}
                    label="All Links"
                  />
                </div>

                <div className="space-y-3">
                  {data.downloads.map((dl, i) => {
                    const href = dl.directUrl || dl.url;
                    const isHubcloud = href.includes("hubcloud");
                    return (
                      <div
                        key={i}
                        className="rounded-md overflow-hidden"
                        style={{ border: "1px solid rgba(255,255,255,0.09)" }}
                      >
                        {/* Label row */}
                        <div
                          className="px-4 py-2.5 text-[11px] font-mono"
                          style={{ background: "rgba(255,255,255,0.03)", color: DIM(0.55), borderBottom: "1px solid rgba(255,255,255,0.07)" }}
                        >
                          {dl.label}
                        </div>
                        {/* Action row */}
                        <div className="flex items-center gap-3 px-4 py-3" style={{ background: "rgba(255,255,255,0.015)" }}>
                          {/* Main download button */}
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid={`link-download-${i}`}
                            className="flex items-center gap-2 px-4 py-2 rounded font-mono font-bold text-[11px] tracking-wide"
                            style={{
                              background: isHubcloud ? "rgba(52,211,153,0.12)" : RA(0.15),
                              border: isHubcloud ? "1px solid rgba(52,211,153,0.35)" : `1px solid ${RA(0.40)}`,
                              color: isHubcloud ? "#34d399" : RED,
                              textDecoration: "none",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLAnchorElement).style.opacity = "0.8";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
                            }}
                          >
                            <Download className="w-3.5 h-3.5" />
                            {isHubcloud ? "Direct Download" : "Download"}
                          </a>

                          {/* If we also have the mdrive fallback, show it */}
                          {dl.directUrl && dl.url !== dl.directUrl && (
                            <a
                              href={dl.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-2 rounded font-mono text-[10px]"
                              style={{
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.10)",
                                color: DIM(0.35),
                                textDecoration: "none",
                              }}
                            >
                              <Link2 className="w-3 h-3" />
                              mdrive
                            </a>
                          )}

                          {/* Copy link */}
                          <div className="ml-auto">
                            <CopyBtn text={href} label="Link" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="mt-4 px-4 py-3 rounded text-[11px] font-mono"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", color: DIM(0.35) }}
                >
                  If any link is expired, open the original post and report it.
                </div>
              </div>
              <div className="mb-5 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
            </>
          )}

          {/* ── YouTube Trailer ── */}
          {data.youtubeId && (
            <div className="mb-5">
              <SectionHeader title="Trailer" />
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
  const RA2 = (a: number) => `rgba(230,50,50,${a})`;
  const DIM2 = (a: number) => `rgba(255,255,255,${a})`;
  const RED2 = "#e63232";

  if (selectedMovie) {
    return <PostView movie={selectedMovie} onBack={() => setSelectedMovie(null)} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded flex items-center justify-center shrink-0"
              style={{ background: RA2(0.15), border: `1px solid ${RA2(0.40)}`, boxShadow: `0 0 14px ${RA2(0.20)}` }}
            >
              <Film className="w-4 h-4" style={{ color: RED2, filter: `drop-shadow(0 0 5px ${RED2})` }} />
            </div>
            <h1 className="text-[18px] font-mono font-bold tracking-tight" style={{ color: "#ffffff" }}>
              MoviesDrive Server
            </h1>
          </div>
          <p className="text-[11px] font-mono ml-10" style={{ color: DIM2(0.35) }}>
            LIVE FEED › new1.moviesdrives.my
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded text-[11px] font-mono font-bold tracking-widest uppercase"
          style={{
            background: RA2(0.10), border: `1px solid ${RA2(0.30)}`,
            color: RED2, textShadow: `0 0 6px ${RA2(0.5)}`,
            opacity: isFetching ? 0.5 : 1,
          }}
          data-testid="button-refresh-movies"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "FETCHING..." : "REFRESH"}
        </button>
      </div>

      <div className="mb-6 h-px" style={{ background: `linear-gradient(90deg, ${RA2(0.30)}, transparent)` }} />

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="w-full aspect-[2/3] rounded-md" style={{ background: DIM2(0.05) }} />
              <div className="mt-2 h-3 rounded" style={{ background: DIM2(0.05) }} />
              <div className="mt-1 h-3 w-2/3 rounded" style={{ background: DIM2(0.03) }} />
            </div>
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-start gap-3 p-5 rounded" style={{ background: RA2(0.07), border: `1px solid ${RA2(0.25)}` }} data-testid="error-movies">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: RED2 }} />
          <div>
            <p className="text-[13px] font-mono font-bold" style={{ color: RED2 }}>FETCH FAILED</p>
            <p className="text-[11px] font-mono mt-1" style={{ color: DIM2(0.40) }}>
              Could not connect to MoviesDrive. Try refreshing.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && movies.length > 0 && (
        <>
          <p className="text-[10px] font-mono mb-4 tracking-widest" style={{ color: DIM2(0.25) }}>
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
                    (e.currentTarget as HTMLDivElement).style.borderColor = RA2(0.45);
                    (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${RA2(0.15)}`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                  }}
                >
                  <div className="w-full aspect-[2/3] relative overflow-hidden" style={{ background: DIM2(0.04) }}>
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
                        style={{ background: RA2(0.20), border: `1px solid ${RA2(0.50)}`, color: RED2 }}
                      >
                        <Film className="w-3 h-3" /> VIEW
                      </div>
                    </div>
                  </div>
                </div>
                <p
                  className="mt-2 text-[11px] font-mono leading-snug line-clamp-2"
                  style={{ color: DIM2(0.65) }}
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
          <Film className="w-10 h-10 mx-auto mb-3" style={{ color: DIM2(0.15) }} />
          <p className="text-[12px] font-mono" style={{ color: DIM2(0.30) }}>NO MOVIES FOUND</p>
        </div>
      )}
    </div>
  );
}

import type { Movie } from '../types';
import { ageBadgeClass, formatRtScore, getDisplayTitle } from '../format';
import MoviePoster from './MoviePoster';
import ModernPoster from './modern/ModernPoster';
import { ageTone, BORDER, INK, INK_2, SANS } from './modern/palette';
import ReleaseDate from './ReleaseDate';

/** Catalog variant of the regular movie rows: shared posters, age colors,
 * score formatting and release-date presentation, without a personal rank. */
export default function CatalogMovieCard({ movie, onSelect, modern = false }: {
  movie: Movie; onSelect: () => void; modern?: boolean;
}) {
  const age = ageTone(movie.commonSenseAge);
  return <button type="button" onClick={onSelect}
    className="flex w-full min-h-[96px] gap-3 px-2 py-4 text-left active:bg-ink-900 transition-colors"
    style={modern ? {fontFamily:SANS,color:INK,borderBottom:`1px solid ${BORDER}`} : undefined}>
    {modern ? <ModernPoster movie={movie} size={54} /> : <MoviePoster movie={movie} size="thumb" />}
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold leading-snug text-ink-100 break-words">{getDisplayTitle(movie)}</span>
        <span className="shrink-0 font-mono text-xs text-ink-500">{movie.year ?? 'Year unknown'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {movie.commonSenseAge ? <span className={`rounded border px-2 py-0.5 text-xs font-bold ${modern ? '' : ageBadgeClass(movie.commonSenseAge)}`}
          style={modern ? {color:age.fg,background:age.bg,borderColor:age.border} : undefined} aria-label={`Common Sense age ${movie.commonSenseAge}`}>{movie.commonSenseAge}</span> : <span className="text-xs text-ink-400">Age guidance unknown</span>}
        <span className="inline-flex items-baseline gap-1 text-xs"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">RT</span><span className="font-semibold tabular-nums text-ink-100">{movie.rottenTomatoes ? formatRtScore(movie.rottenTomatoes) : 'Pending'}</span></span>
        <span className="inline-flex items-baseline gap-1 text-xs"><span className="text-[10px] font-semibold text-ink-500">IMDb</span><span className="font-semibold tabular-nums text-ink-100">{movie.imdb ?? 'Pending'}</span></span>
      </div>
      {!movie.imdb && !movie.rottenTomatoes && <p className="text-xs text-ink-400">Ratings pending</p>}
      {movie.production && <p className="text-xs font-medium text-ink-400 break-words" style={modern ? {color:INK_2}:undefined}>{movie.production}</p>}
      {movie.awards && <p className="text-xs text-amber-glow/85 break-words">{movie.awards}</p>}
      <ReleaseDate releaseDate={movie.releaseDate} />
    </div>
  </button>;
}

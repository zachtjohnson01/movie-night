import { useMemo, useState } from 'react';
import type { Movie } from '../types';
import {
  ageBadgeClass,
  earliestWatched,
  formatDate,
  formatMonthYear,
  getDisplayTitle,
  sortWatched,
} from '../format';
import BuildStamp from './BuildStamp';
import MoviePoster from './MoviePoster';

type Props = {
  movies: Movie[];
  canWrite: boolean;
  isOwner: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
  onBulkLink: () => void;
  onEnhanceAll: () => void;
};

export default function WatchedList({
  movies,
  canWrite,
  isOwner,
  onSelect,
  onAdd,
  onBulkLink,
  onEnhanceAll,
}: Props) {
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [sortOpen, setSortOpen] = useState(false);

  const watchedAll = useMemo(
    () =>
      sortWatched(
        movies.filter((m) => m.watched),
        sortOrder === 'newest' ? 'desc' : 'asc',
      ),
    [movies, sortOrder],
  );

  const unlinkedCount = useMemo(
    () =>
      movies.filter((m) => m.imdbId == null && m.title.trim().length >= 3)
        .length,
    [movies],
  );

  const enhanceableCount = useMemo(
    () =>
      watchedAll.filter((m) => m.production == null || m.awards == null).length,
    [watchedAll],
  );

  const watched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return watchedAll;
    // Match against both the canonical title AND the display override
    // so searching "Lotte" finds a movie stored as
    // "Leiutajateküla Lotte" with displayTitle "Lotte from Gadgetville".
    return watchedAll.filter((m) => {
      const t = m.title.toLowerCase();
      const d = m.displayTitle?.toLowerCase() ?? '';
      return t.includes(q) || d.includes(q);
    });
  }, [watchedAll, query]);

  const earliest = useMemo(
    () => earliestWatched(watchedAll),
    [watchedAll],
  );

  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto max-w-xl">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Family Movie Night
            </div>
            <h1 className="mt-1 text-[32px] font-bold leading-none tracking-tight">
              {watched.length}{' '}
              <span className="text-ink-300 font-semibold">
                {watched.length === 1 ? 'movie' : 'movies'}{' '}
                {searching ? 'found' : 'watched'}
              </span>
            </h1>
            {earliest && !searching && (
              <p className="mt-1.5 text-xs text-ink-400">
                since {formatMonthYear(earliest)}
              </p>
            )}
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={onAdd}
              aria-label="Add movie"
              className="shrink-0 min-h-[44px] min-w-[44px] rounded-2xl bg-amber-glow text-ink-950 font-bold flex items-center justify-center active:opacity-80 shadow-lg shadow-amber-glow/10"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-3 relative">
          <input
            type="search"
            inputMode="search"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Search watched movies…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-11 rounded-2xl bg-ink-800 border border-ink-700 pl-11 pr-4 text-base placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60 focus:bg-ink-800"
          />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-500"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((o) => !o)}
              className="min-h-[36px] px-3 rounded-full text-sm font-medium bg-ink-800 text-ink-300 flex items-center gap-1.5 active:bg-ink-700"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5 shrink-0"
                aria-hidden
              >
                {sortOrder === 'newest' ? (
                  <path d="M12 5v14M5 12l7 7 7-7" />
                ) : (
                  <path d="M12 19V5M5 12l7-7 7 7" />
                )}
              </svg>
              <span>{sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${sortOpen ? 'rotate-180' : ''}`}
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {sortOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setSortOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1.5 z-30 bg-ink-900 border border-ink-700 rounded-2xl shadow-2xl overflow-hidden min-w-[160px]">
                  {(['newest', 'oldest'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => { setSortOrder(opt); setSortOpen(false); }}
                      className={`w-full min-h-[44px] px-4 text-left text-sm font-medium flex items-center gap-2.5 ${
                        sortOrder === opt
                          ? 'bg-amber-glow/10 text-amber-glow'
                          : 'text-ink-300 active:bg-ink-800'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-4 h-4 shrink-0"
                        aria-hidden
                      >
                        {opt === 'newest' ? (
                          <path d="M12 5v14M5 12l7 7 7-7" />
                        ) : (
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        )}
                      </svg>
                      {opt === 'newest' ? 'Newest first' : 'Oldest first'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <BuildStamp />
        </div>
      </header>

      {canWrite && unlinkedCount > 0 && !query && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={onBulkLink}
            className="w-full min-h-[48px] rounded-2xl bg-amber-glow/10 border border-amber-glow/30 text-amber-glow font-semibold active:bg-amber-glow/20 flex items-center justify-center gap-2"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
              aria-hidden
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.76 5.24" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>
              Link {unlinkedCount} unlinked{' '}
              {unlinkedCount === 1 ? 'movie' : 'movies'}
            </span>
          </button>
        </div>
      )}

      {isOwner && watchedAll.length > 0 && !query && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={onEnhanceAll}
            className={`w-full min-h-[48px] rounded-2xl font-semibold active:bg-amber-glow/20 flex items-center justify-center gap-2 ${
              enhanceableCount > 0
                ? 'bg-amber-glow/10 border border-amber-glow/30 text-amber-glow'
                : 'bg-ink-800/60 border border-ink-700 text-ink-300 active:bg-ink-700'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
              aria-hidden
            >
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
            </svg>
            <span>
              {enhanceableCount > 0
                ? `Enhance ${enhanceableCount} ${enhanceableCount === 1 ? 'movie' : 'movies'} with Claude`
                : 'Refresh studio + awards with Claude'}
            </span>
          </button>
        </div>
      )}

      {watchedAll.length === 0 ? (
        <EmptyState />
      ) : watched.length === 0 ? (
        <div className="px-6 pt-10 text-center text-ink-400 text-sm">
          Nothing matches “{query}”
        </div>
      ) : (
        <ul className="px-2 pt-1">
          {watched.map((m) => (
            <li key={m.title}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                className="w-full min-h-[92px] flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-ink-800 transition-colors text-left"
              >
                <MoviePoster movie={m} size="thumb" />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold leading-snug truncate">
                    {getDisplayTitle(m)}
                  </div>
                  <div className="mt-1 text-sm">
                    {m.dateWatched ? (
                      <span className="text-ink-300">
                        {formatDate(m.dateWatched)}
                      </span>
                    ) : (
                      <span className="text-amber-glow/70 italic font-medium">
                        Date unknown
                      </span>
                    )}
                  </div>
                  <MetricsRow movie={m} />
                </div>
                {m.commonSenseAge && (
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1.5 text-sm font-bold tabular-nums ${ageBadgeClass(
                      m.commonSenseAge,
                    )}`}
                  >
                    {m.commonSenseAge}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetricsRow({ movie: m }: { movie: Movie }) {
  if (!m.rottenTomatoes && !m.imdb && !m.production && !m.awards) {
    return (
      <div className="mt-1.5 text-xs text-ink-600 italic">no ratings</div>
    );
  }
  return (
    <div className="mt-1.5 space-y-1">
      {(m.rottenTomatoes || m.imdb) && (
        <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-sm">
          {m.rottenTomatoes && (
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                RT
              </span>
              <span className="text-ink-100 font-semibold tabular-nums">
                {m.rottenTomatoes}
              </span>
            </span>
          )}
          {m.imdb && (
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                IMDb
              </span>
              <span className="text-ink-100 font-semibold tabular-nums">
                {m.imdb}
              </span>
            </span>
          )}
        </div>
      )}
      {(m.production || m.awards) && (
        <div className="flex gap-2 flex-wrap text-xs text-ink-500 font-medium">
          {m.production && <span className="truncate">{m.production}</span>}
          {m.production && m.awards && (
            <span className="opacity-50">·</span>
          )}
          {m.awards && (
            <span className="text-amber-glow/85 truncate">{m.awards}</span>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 pt-12 pb-20 text-center">
      <div className="mx-auto w-14 h-14 rounded-full bg-ink-800 flex items-center justify-center mb-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-7 h-7 text-ink-400"
          aria-hidden
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
      <div className="text-base text-ink-200 font-semibold">
        No movies watched yet
      </div>
      <p className="mt-1 text-sm text-ink-400">
        Pick something from the Wishlist tab to kick off Friday night.
      </p>
    </div>
  );
}

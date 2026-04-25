import { useLayoutEffect, useMemo, useState } from 'react';
import type { Movie } from '../types';
import { ageBadgeClass, getDisplayTitle, sortWishlist } from '../format';
import BuildStamp from './BuildStamp';
import MoviePoster from './MoviePoster';

type Props = {
  movies: Movie[];
  canWrite: boolean;
  isOwner: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
  onEnhanceAll: () => void;
  onReorder: (orderedTitles: string[]) => void;
};

export default function Wishlist({
  movies,
  canWrite,
  isOwner,
  onSelect,
  onAdd,
  onEnhanceAll,
  onReorder,
}: Props) {
  useLayoutEffect(() => {
    const toTop = () => {
      window.scrollTo(0, 0);
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = 0;
      }
    };
    toTop();
    const rafId = requestAnimationFrame(toTop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const [query, setQuery] = useState('');
  const [reordering, setReordering] = useState(false);

  const wishlistAll = useMemo(
    () => sortWishlist(movies.filter((m) => !m.watched)),
    [movies],
  );

  const wishlist = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return wishlistAll;
    return wishlistAll.filter((m) => {
      const t = m.title.toLowerCase();
      const d = m.displayTitle?.toLowerCase() ?? '';
      return t.includes(q) || d.includes(q);
    });
  }, [wishlistAll, query]);

  const enhanceableCount = useMemo(
    () =>
      wishlistAll.filter((m) => m.production == null || m.awards == null)
        .length,
    [wishlistAll],
  );

  const canReorder = canWrite && wishlistAll.length >= 2;

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= wishlistAll.length) return;
    const next = [...wishlistAll];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((m) => m.title));
  }

  return (
    <div className="mx-auto max-w-xl">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Up Next
            </div>
            <h1 className="mt-1 text-[28px] font-bold leading-none tracking-tight">
              {wishlist.length}{' '}
              <span className="text-ink-300 font-semibold">
                {wishlist.length === 1 ? 'movie' : 'movies'} to watch
              </span>
            </h1>
          </div>
          {reordering ? (
            <button
              type="button"
              onClick={() => setReordering(false)}
              className="shrink-0 min-h-[44px] px-4 rounded-2xl bg-amber-glow text-ink-950 font-bold flex items-center justify-center active:opacity-80 shadow-lg shadow-amber-glow/10"
            >
              Done
            </button>
          ) : (
            canWrite && (
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
            )
          )}
        </div>

        {!reordering && (
          <div className="mt-3 relative">
            <input
              type="search"
              inputMode="search"
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="Search titles…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="w-full h-12 rounded-2xl bg-ink-800 border border-ink-700 pl-11 pr-4 text-base placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60 focus:bg-ink-800"
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
        )}

        {!reordering && canReorder && !query && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setReordering(true)}
              className="min-h-[40px] px-3 rounded-xl text-sm font-semibold text-ink-300 border border-ink-700 active:bg-ink-800 flex items-center gap-1.5"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
                aria-hidden
              >
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
              Reorder
            </button>
          </div>
        )}

        <div className="mt-2">
          <BuildStamp />
        </div>
      </header>

      {!reordering && isOwner && wishlistAll.length > 0 && !query && (
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

      {wishlist.length === 0 ? (
        <div className="px-6 pt-10 text-center text-ink-400 text-sm">
          {query
            ? `Nothing matches “${query}”`
            : canWrite
              ? 'Your queue is empty. Tap + to add a movie.'
              : 'Your queue is empty.'}
        </div>
      ) : (
        <ul className="px-2 pt-1">
          {wishlist.map((m, i) =>
            reordering ? (
              <li
                key={m.title}
                className="flex items-center gap-2 px-3 py-3 min-h-[88px]"
              >
                <MoviePoster movie={m} size="thumb" />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold leading-snug truncate">
                    {getDisplayTitle(m)}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${getDisplayTitle(m)} up`}
                    className="min-h-[44px] min-w-[44px] rounded-xl bg-ink-800 border border-ink-700 text-ink-100 flex items-center justify-center active:bg-ink-700 disabled:opacity-30 disabled:active:bg-ink-800"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5"
                      aria-hidden
                    >
                      <path d="m18 15-6-6-6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === wishlist.length - 1}
                    aria-label={`Move ${getDisplayTitle(m)} down`}
                    className="min-h-[44px] min-w-[44px] rounded-xl bg-ink-800 border border-ink-700 text-ink-100 flex items-center justify-center active:bg-ink-700 disabled:opacity-30 disabled:active:bg-ink-800"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5"
                      aria-hidden
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </li>
            ) : (
              <li key={m.title}>
                <button
                  type="button"
                  onClick={() => onSelect(m)}
                  className="w-full min-h-[88px] flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-ink-800 transition-colors text-left"
                >
                  <MoviePoster movie={m} size="thumb" />
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold leading-snug truncate">
                      {getDisplayTitle(m)}
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
            ),
          )}
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

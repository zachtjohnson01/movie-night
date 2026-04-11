import { useMemo, useState } from 'react';
import type { Movie } from '../types';
import { ageBadgeClass } from '../format';

type Props = {
  movies: Movie[];
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
};

export default function Wishlist({ movies, onSelect, onAdd }: Props) {
  const [query, setQuery] = useState('');

  const wishlist = useMemo(() => {
    const all = movies
      .filter((m) => !m.watched)
      .sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) => m.title.toLowerCase().includes(q));
  }, [movies, query]);

  return (
    <div className="mx-auto max-w-xl">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Wishlist
            </div>
            <h1 className="mt-1 text-[28px] font-bold leading-none tracking-tight">
              {wishlist.length}{' '}
              <span className="text-ink-300 font-semibold">
                {wishlist.length === 1 ? 'movie' : 'movies'} to watch
              </span>
            </h1>
          </div>
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
        </div>

        <div className="mt-3 relative">
          <input
            type="search"
            inputMode="search"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Search titles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
      </header>

      {wishlist.length === 0 ? (
        <div className="px-6 pt-10 text-center text-ink-400 text-sm">
          {query
            ? `Nothing matches “${query}”`
            : 'Your wishlist is empty. Tap + to add a movie.'}
        </div>
      ) : (
        <ul className="px-2 pt-1">
          {wishlist.map((m) => (
            <li key={m.title}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                className="w-full min-h-[68px] flex items-center gap-3 px-3 py-3.5 rounded-2xl active:bg-ink-800 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold leading-snug truncate">
                    {m.title}
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
  if (!m.rottenTomatoes && !m.imdb) {
    return (
      <div className="mt-1.5 text-xs text-ink-600 italic">no ratings</div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-sm">
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
  );
}

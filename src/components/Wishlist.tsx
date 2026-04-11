import { useMemo, useState } from 'react';
import type { Movie } from '../types';
import { ageBadgeClass } from '../format';

type Props = {
  movies: Movie[];
  onSelect: (movie: Movie) => void;
};

export default function Wishlist({ movies, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const wishlist = useMemo(() => {
    const all = movies
      .filter((m) => !m.dateWatched)
      .sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) => m.title.toLowerCase().includes(q));
  }, [movies, query]);

  return (
    <div className="mx-auto max-w-xl">
      <header className="safe-top px-5 pt-6 pb-4">
        <div className="text-[11px] uppercase tracking-[0.2em] text-crimson-bright/90 font-semibold">
          Wishlist
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {wishlist.length}{' '}
          <span className="text-ink-300 font-semibold">
            {wishlist.length === 1 ? 'movie' : 'movies'} to watch
          </span>
        </h1>

        <div className="mt-4 relative">
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
            : 'Your wishlist is empty. Add a title to movies.json.'}
        </div>
      ) : (
        <ul className="px-2">
          {wishlist.map((m) => (
            <li key={m.title}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                className="w-full min-h-[64px] flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-ink-800 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold leading-snug truncate">
                    {m.title}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-400">
                    {m.rottenTomatoes && (
                      <span>
                        <span className="text-ink-500">RT </span>
                        <span className="text-ink-300 tabular-nums">
                          {m.rottenTomatoes}
                        </span>
                      </span>
                    )}
                    {m.imdb && (
                      <span>
                        <span className="text-ink-500">IMDb </span>
                        <span className="text-ink-300 tabular-nums">
                          {m.imdb}
                        </span>
                      </span>
                    )}
                    {!m.rottenTomatoes && !m.imdb && (
                      <span className="text-ink-600">no ratings</span>
                    )}
                  </div>
                </div>
                {m.commonSenseAge && (
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${ageBadgeClass(
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

import { useMemo } from 'react';
import type { Movie } from '../types';
import {
  ageBadgeClass,
  earliestWatched,
  formatDate,
  formatMonthYear,
  sortWatched,
} from '../format';

type Props = {
  movies: Movie[];
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
};

export default function WatchedList({ movies, onSelect, onAdd }: Props) {
  const watched = useMemo(
    () => sortWatched(movies.filter((m) => m.watched)),
    [movies],
  );

  const earliest = useMemo(() => earliestWatched(watched), [watched]);

  return (
    <div className="mx-auto max-w-xl">
      <header className="safe-top px-5 pt-6 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-crimson-bright/90 font-semibold">
              Friday Movie Night
            </div>
            <h1 className="mt-2 text-4xl font-bold leading-none tracking-tight">
              {watched.length}{' '}
              <span className="text-ink-300 font-semibold">
                {watched.length === 1 ? 'movie' : 'movies'} watched
              </span>
            </h1>
            {earliest && (
              <p className="mt-2 text-sm text-ink-400">
                since {formatMonthYear(earliest)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add movie"
            className="shrink-0 min-h-[44px] min-w-[44px] rounded-2xl bg-amber-glow text-ink-950 font-bold flex items-center justify-center active:opacity-80"
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
      </header>

      {watched.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="px-2">
          {watched.map((m) => (
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
                  <div className="mt-1 text-xs text-ink-400">
                    {m.dateWatched ? (
                      formatDate(m.dateWatched)
                    ) : (
                      <span className="text-ink-500 italic">Date unknown</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-ink-400">
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

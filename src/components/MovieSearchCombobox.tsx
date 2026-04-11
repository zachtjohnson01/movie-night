import { useEffect, useRef, useState } from 'react';
import {
  isOmdbConfigured,
  searchMovies,
  type OmdbSearchResult,
} from '../omdb';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onPick: (result: OmdbSearchResult) => void;
  autoFocus?: boolean;
};

/**
 * Debounced title input that searches OMDB as you type and shows a
 * thumbnail dropdown of candidate movies. Picking a result calls
 * `onPick`; typing without picking calls `onChange`.
 *
 * Degrades gracefully to a plain text input when OMDB isn't configured.
 */
export default function MovieSearchCombobox({
  value,
  onChange,
  onPick,
  autoFocus,
}: Props) {
  const [results, setResults] = useState<OmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  // Skip the next debounce cycle — used when we just picked a result and
  // programmatically updated the input's value, so we don't immediately
  // re-search the picked title.
  const skipNextSearch = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Dismiss the dropdown on outside clicks.
  useEffect(() => {
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, []);

  // Debounced search on value change.
  useEffect(() => {
    if (!isOmdbConfigured) return;
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      setHasSearched(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const r = await searchMovies(trimmed);
        if (cancelled) return;
        setResults(r);
        setHasSearched(true);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  function handlePick(r: OmdbSearchResult) {
    skipNextSearch.current = true;
    onPick(r);
    setOpen(false);
    setResults([]);
  }

  const showDropdown =
    isOmdbConfigured &&
    open &&
    value.trim().length >= 3 &&
    (loading || error || results.length > 0 || hasSearched);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={
          isOmdbConfigured ? 'Search movies or type manually…' : 'Movie title'
        }
        autoFocus={autoFocus}
        autoCorrect="off"
        className="w-full rounded-2xl bg-ink-800 border border-ink-700 px-4 py-3 text-base focus:outline-none focus:border-amber-glow/60"
      />

      {showDropdown && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl bg-ink-900 border border-ink-700 shadow-2xl shadow-black/60 overflow-hidden">
          {loading && (
            <div className="px-4 py-3 text-sm text-ink-400">
              Searching OMDB…
            </div>
          )}

          {error && (
            <div className="px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          {!loading && !error && results.length === 0 && hasSearched && (
            <div className="px-4 py-3 text-sm text-ink-400">
              No matches on OMDB. You can still use "{value.trim()}" as a
              custom entry below.
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <ul className="max-h-[min(60vh,24rem)] overflow-auto">
              {results.map((r) => (
                <li key={r.imdbId}>
                  <button
                    type="button"
                    onClick={() => handlePick(r)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-ink-800 border-b border-ink-800/60 last:border-b-0"
                  >
                    {r.poster ? (
                      <img
                        src={r.poster}
                        alt=""
                        loading="lazy"
                        className="shrink-0 w-10 h-[60px] rounded-md object-cover bg-ink-800"
                      />
                    ) : (
                      <div className="shrink-0 w-10 h-[60px] rounded-md bg-ink-800 border border-ink-700" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-100 leading-snug">
                        {r.title}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-400">
                        {r.year}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

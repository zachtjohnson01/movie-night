import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Movie } from '../types';
import { ageBadgeClass } from '../format';
import {
  addRecommendationBatch,
  clearRecommendations,
  getCachedRecommendations,
  RECS_BATCH_SIZE,
  type Recommendation,
} from '../recommendations';

type Props = {
  movies: Movie[];
};

type State =
  | { status: 'idle'; items: Recommendation[]; lastAdded: string[] }
  | { status: 'loading'; items: Recommendation[]; lastAdded: string[] }
  | { status: 'ready'; items: Recommendation[]; lastAdded: string[] }
  | { status: 'error'; items: Recommendation[]; lastAdded: string[] };

export default function Recommendations({ movies }: Props) {
  const [state, setState] = useState<State>(() => {
    const cached = getCachedRecommendations();
    if (cached && cached.items.length) {
      return {
        status: 'ready',
        items: cached.items,
        lastAdded: cached.lastAdded || [],
      };
    }
    return { status: 'idle', items: [], lastAdded: [] };
  });
  const [error, setError] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);

  const watchedCount = useMemo(
    () => movies.filter((m) => m.watched).length,
    [movies],
  );

  const loadBatch = useCallback(async () => {
    if (movies.length === 0) return;
    setError(null);
    setAddingMore(true);
    setState((s) => ({
      ...s,
      status: s.items.length ? s.status : 'loading',
    }));
    try {
      const out = await addRecommendationBatch(movies);
      if (out.lastSurvived === 0) {
        throw new Error(
          out.lastRawCount > 0
            ? 'All suggestions were already on your list. Try again for fresh picks.'
            : "Couldn't parse response. Try again.",
        );
      }
      setState({
        status: 'ready',
        items: out.items,
        lastAdded: out.lastAdded,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState((s) => ({
        ...s,
        status: s.items.length ? 'ready' : 'error',
      }));
    } finally {
      setAddingMore(false);
    }
  }, [movies]);

  // Auto-load on first visit when there's nothing cached.
  useEffect(() => {
    if (state.status === 'idle' && movies.length > 0) {
      void loadBatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies.length]);

  // Fade out the "new" highlight after a few seconds.
  useEffect(() => {
    if (!state.lastAdded.length) return;
    const t = setTimeout(
      () => setState((s) => ({ ...s, lastAdded: [] })),
      3200,
    );
    return () => clearTimeout(t);
  }, [state.lastAdded]);

  const newSet = useMemo(
    () => new Set(state.lastAdded.map((t) => t.toLowerCase())),
    [state.lastAdded],
  );

  function confirmReset() {
    if (!window.confirm('Clear all recommendations and start over?')) return;
    clearRecommendations();
    setState({ status: 'idle', items: [], lastAdded: [] });
    setError(null);
    setTimeout(() => void loadBatch(), 50);
  }

  const loading = state.status === 'loading';

  return (
    <div className="mx-auto max-w-xl">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
                For you
              </div>
              {state.items.length > 0 && (
                <button
                  type="button"
                  onClick={confirmReset}
                  className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-400 active:text-ink-200 min-h-[32px] px-2"
                >
                  Reset
                </button>
              )}
            </div>
            <h1 className="mt-1 font-display text-[32px] font-medium leading-[0.95] tracking-tight">
              <span className="italic">Ranked</span>{' '}
              <span className="text-ink-300 font-normal">for your</span>
              <br />
              <span className="text-ink-300 font-light italic">
                {watchedCount} nights.
              </span>
            </h1>
            <p className="mt-2 text-xs text-ink-400 leading-relaxed">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size={10} />
                  Looking through your list…
                </span>
              ) : (
                <>
                  {state.items.length}{' '}
                  {state.items.length === 1 ? 'pick' : 'picks'}, best first ·
                  ranked by RT+IMDb, then CSM age, studio, awards, notes
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="pt-2">
        {loading && state.items.length === 0 && (
          <>
            <RecSkeleton />
            <RecSkeleton />
            <RecSkeleton />
            <RecSkeleton />
          </>
        )}

        <ul>
          {state.items.map((rec, i) => (
            <RecRow
              key={rec.title}
              rec={rec}
              rank={i + 1}
              isNew={newSet.has(rec.title.toLowerCase())}
            />
          ))}
        </ul>

        {state.items.length > 0 && (
          <div className="px-5 pt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void loadBatch()}
              disabled={addingMore}
              className={`w-full min-h-[48px] rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-colors ${
                addingMore
                  ? 'bg-ink-800 border border-ink-700 text-ink-400 cursor-default'
                  : 'bg-amber-glow text-ink-950 active:opacity-80'
              }`}
            >
              {addingMore ? (
                <>
                  <Spinner size={12} />
                  Finding {RECS_BATCH_SIZE} more…
                </>
              ) : (
                <>+ Add {RECS_BATCH_SIZE} more</>
              )}
            </button>
            {error && (
              <div className="text-center text-xs text-crimson-bright">
                {error}
              </div>
            )}
          </div>
        )}

        {state.status === 'error' && state.items.length === 0 && (
          <div className="mx-5 mt-5 p-4 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-300 leading-relaxed">
            Couldn’t generate picks right now.
            {error && (
              <span className="block mt-1 text-xs text-ink-500">{error}</span>
            )}
            <button
              type="button"
              onClick={() => void loadBatch()}
              className="mt-3 min-h-[40px] px-4 rounded-full bg-amber-glow text-ink-950 font-bold text-sm active:opacity-80"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === 'idle' && movies.length === 0 && (
          <div className="px-6 pt-10 text-center text-ink-400 text-sm">
            Add a watched movie first — recommendations are based on your list.
          </div>
        )}
      </div>
    </div>
  );
}

function RecRow({
  rec,
  rank,
  isNew,
}: {
  rec: Recommendation;
  rank: number;
  isNew: boolean;
}) {
  const topRank = rank <= 3;
  return (
    <li
      className={`flex gap-3 px-4 py-3.5 border-b border-ink-800/70 transition-colors ${
        isNew ? 'bg-amber-glow/[0.06]' : ''
      }`}
    >
      <div className="w-8 shrink-0 flex flex-col items-center pt-1 gap-0.5">
        <div
          className={`font-display italic leading-none tracking-tight ${
            topRank ? 'text-amber-glow' : 'text-ink-300'
          }`}
          style={{
            fontSize: rank <= 9 ? 28 : 22,
            fontWeight: topRank ? 600 : 400,
            letterSpacing: -1,
          }}
        >
          {rank}
        </div>
        {rec.fitScore != null && (
          <div className="text-[9px] font-mono text-ink-500 tabular-nums tracking-wider">
            {rec.fitScore}
          </div>
        )}
      </div>

      <div className="w-[60px] h-[90px] rounded-md bg-ink-800 border border-ink-700 shrink-0 flex items-center justify-center">
        <span className="text-xl font-bold text-ink-600 select-none">
          {rec.title.charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[15px] font-semibold leading-tight text-ink-100 truncate">
            {rec.title}
          </div>
          {rec.year && (
            <div className="text-[11px] font-mono text-ink-500 shrink-0 tabular-nums">
              {rec.year}
            </div>
          )}
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          {rec.commonSenseAge && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ageBadgeClass(
                rec.commonSenseAge,
              )}`}
            >
              {rec.commonSenseAge}
            </span>
          )}
          {rec.rottenTomatoes && (
            <span className="inline-flex items-baseline gap-1 text-[11px]">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">
                RT
              </span>
              <span className="text-ink-300 font-semibold tabular-nums">
                {rec.rottenTomatoes}
              </span>
            </span>
          )}
          {rec.imdb && (
            <span className="inline-flex items-baseline gap-1 text-[11px]">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">
                IMDb
              </span>
              <span className="text-ink-300 font-semibold tabular-nums">
                {rec.imdb}
              </span>
            </span>
          )}
        </div>

        {rec.why && (
          <div className="font-display italic text-[13px] text-ink-300 leading-snug">
            “{rec.why}”
          </div>
        )}

        {(rec.studio || rec.awards) && (
          <div className="flex gap-2 flex-wrap text-[10.5px] text-ink-500 font-medium">
            {rec.studio && <span>{rec.studio}</span>}
            {rec.studio && rec.awards && (
              <span className="opacity-50">·</span>
            )}
            {rec.awards && (
              <span className="text-amber-glow/85">🏆 {rec.awards}</span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function RecSkeleton() {
  return (
    <div className="flex gap-3 px-4 py-3.5 border-b border-ink-800/70 opacity-70">
      <div className="w-8" />
      <div className="w-[60px] h-[90px] rounded-md bg-ink-800 shrink-0 shimmer" />
      <div className="flex-1 flex flex-col gap-2 pt-1">
        <div className="w-[70%] h-4 rounded bg-ink-800 shimmer" />
        <div className="w-[45%] h-3 rounded bg-ink-800 shimmer" />
        <div className="w-[90%] h-3 rounded bg-ink-800 shimmer" />
        <div className="w-[60%] h-3 rounded bg-ink-800 shimmer" />
      </div>
    </div>
  );
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-full border-2 border-amber-glow border-t-transparent animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

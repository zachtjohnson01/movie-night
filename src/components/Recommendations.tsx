import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { Candidate, Movie } from '../types';
import { ageBadgeClass } from '../format';
import type { CandidatePoolApi } from '../useCandidatePool';
import { countEffectiveCandidates, expandPool, extractUnique, rankTopPicks, type RankedPick } from '../recommendations';

type Props = {
  movies: Movie[];
  pool: CandidatePoolApi;
  canWrite: boolean;
  onSelectPick: (c: Candidate) => void;
  reloadMovies: () => void;
  onOpenPool: () => void;
};

// Minimum visible spinner time on refresh so the button doesn't flicker
// when the underlying fetch resolves in < 100ms.
const MIN_REFRESH_MS = 450;

const TOP_N = 20;
const EXPAND_BATCH = 100;
const SEED_BATCHES = 5; // 5 × 100 = 500-film initial pool

export default function Recommendations({
  movies,
  pool,
  canWrite,
  onSelectPick,
  reloadMovies,
  onOpenPool,
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

  const [busy, setBusy] = useState<
    | { kind: 'idle' }
    | { kind: 'seeding'; done: number; total: number; added: number }
    | { kind: 'expanding' }
  >({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const picks = useMemo(
    () => rankTopPicks(pool.candidates, movies, TOP_N),
    [pool.candidates, movies],
  );

  const effectiveCount = useMemo(
    () => countEffectiveCandidates(pool.candidates),
    [pool.candidates],
  );

  const libraryTitles = useMemo(
    () => movies.map((m) => m.title),
    [movies],
  );

  const libraryDirectors = useMemo(() => extractUnique(movies.map((m) => m.director)), [movies]);
  const libraryWriters = useMemo(() => extractUnique(movies.map((m) => m.writer)), [movies]);
  const libraryStudios = useMemo(() => extractUnique(movies.map((m) => m.production)), [movies]);

  const runExpansion = useCallback(
    async (batches: number) => {
      setError(null);
      let added = 0;
      const currentPoolTitles = () => pool.candidates.map((c) => c.title);
      for (let i = 0; i < batches; i++) {
        if (batches > 1) {
          setBusy({
            kind: 'seeding',
            done: i,
            total: batches,
            added,
          });
        } else {
          setBusy({ kind: 'expanding' });
        }
        try {
          // Build the ban list from the *live* pool each iteration so the
          // LLM doesn't repeat titles the previous batch just added.
          const fresh = await expandPool(
            [...currentPoolTitles()],
            libraryTitles,
            EXPAND_BATCH,
            { directors: libraryDirectors, writers: libraryWriters, studios: libraryStudios },
          );
          if (fresh.length === 0) break;
          await pool.appendCandidates(fresh);
          added += fresh.length;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          break;
        }
      }
      setBusy({ kind: 'idle' });
    },
    [libraryTitles, libraryDirectors, libraryWriters, libraryStudios, pool],
  );

  const loading = pool.status === 'loading';
  const poolEmpty = pool.status === 'empty';
  const poolErrored = pool.status === 'error';
  const seeding = busy.kind === 'seeding';
  const expanding = busy.kind === 'expanding';
  const anyBusy = seeding || expanding;

  const handleRefresh = useCallback(async () => {
    if (refreshing || loading) return;
    setRefreshing(true);
    pool.reload();
    reloadMovies();
    await new Promise((r) => setTimeout(r, MIN_REFRESH_MS));
    setRefreshing(false);
  }, [refreshing, loading, pool, reloadMovies]);

  return (
    <div className="mx-auto max-w-xl">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              For you
            </div>
            <h1 className="mt-1 font-display text-[32px] font-medium leading-[0.95] tracking-tight">
              <span className="italic">Top {TOP_N}</span>{' '}
              <span className="text-ink-300 font-normal">picks from</span>
              <br />
              <span className="text-ink-300 font-light italic">
                {effectiveCount} candidates.
              </span>
            </h1>
            <p className="mt-2 text-xs text-ink-400 leading-relaxed">
              Ranked by RT, IMDb, CSM age, studio, awards.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || loading}
            aria-label="Refresh picks"
            className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center border transition-colors ${
              refreshing || loading
                ? 'bg-ink-900 border-ink-800 text-ink-500 cursor-default'
                : 'bg-ink-800 border-ink-700 text-ink-200 active:bg-ink-700'
            }`}
          >
            <RefreshIcon spinning={refreshing} />
          </button>
        </div>
      </header>

      <div className="pt-2">
        {!poolEmpty && !loading && !poolErrored && canWrite && (
          <div className="px-5 pt-3 pb-1 flex flex-col gap-1.5">
            <button
              type="button"
              disabled={anyBusy}
              onClick={() => void runExpansion(1)}
              className={`w-full min-h-[44px] rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                anyBusy
                  ? 'bg-ink-800 border border-ink-700 text-ink-400 cursor-default'
                  : 'bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700'
              }`}
            >
              {expanding ? (
                <>
                  <Spinner size={10} />
                  Adding {EXPAND_BATCH} more…
                </>
              ) : (
                <>Pool: {pool.candidates.length} · Expand +{EXPAND_BATCH}</>
              )}
            </button>
            <button
              type="button"
              disabled={anyBusy}
              onClick={onOpenPool}
              className={`w-full min-h-[44px] rounded-2xl text-sm font-semibold transition-colors ${
                anyBusy
                  ? 'bg-ink-800 border border-ink-700 text-ink-400 cursor-default'
                  : 'bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700'
              }`}
            >
              Manage pool →
            </button>
            {error && (
              <p className="text-center text-xs text-crimson-bright">{error}</p>
            )}
          </div>
        )}

        {loading && (
          <>
            <RecSkeleton />
            <RecSkeleton />
            <RecSkeleton />
            <RecSkeleton />
          </>
        )}

        {poolErrored && (
          <div className="mx-5 mt-8 p-5 rounded-2xl bg-ink-900 border border-crimson-deep/40 text-sm text-ink-300 leading-relaxed">
            <p className="font-semibold text-ink-100 mb-2">
              Couldn't load the candidate pool
            </p>
            <p className="text-ink-400 mb-4">
              Something went wrong reading from Supabase. Check your
              connection and try again.
            </p>
            <button
              type="button"
              onClick={pool.reload}
              className="w-full min-h-[44px] rounded-2xl text-sm font-semibold bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700"
            >
              Try again
            </button>
          </div>
        )}

        {poolEmpty && !loading && !seeding && (
          <div className="mx-5 mt-8 p-5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-300 leading-relaxed">
            <p className="font-semibold text-ink-100 mb-2">
              No candidate pool yet
            </p>
            <p className="text-ink-400 mb-4">
              Seed a pool of ~{EXPAND_BATCH * SEED_BATCHES} family films to
              rank against. Each film is enriched with authoritative scores
              from OMDB. This takes a couple minutes.
            </p>
            {canWrite ? (
              <button
                type="button"
                onClick={() => void runExpansion(SEED_BATCHES)}
                className="w-full min-h-[48px] rounded-2xl font-bold text-base bg-amber-glow text-ink-950 active:opacity-80"
              >
                Seed candidate pool
              </button>
            ) : (
              <p className="text-xs text-ink-500 italic">
                Sign in as an allowed user to seed the pool.
              </p>
            )}
            {error && (
              <p className="mt-3 text-xs text-crimson-bright">{error}</p>
            )}
          </div>
        )}

        {seeding && (
          <div className="mx-5 mt-8 p-5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-300 leading-relaxed">
            <div className="flex items-center gap-2 mb-2">
              <Spinner size={12} />
              <span className="font-semibold text-ink-100">
                Seeding pool… ({busy.done}/{busy.total})
              </span>
            </div>
            <p className="text-ink-400 text-xs">
              {busy.added} films added so far. Don't close the tab.
            </p>
          </div>
        )}

        {!poolEmpty && !loading && !poolErrored && (
          <ul>
            {picks.map((rec, i) => (
              <RecRow
                key={rec.title}
                rec={rec}
                rank={i + 1}
                onSelect={() => onSelectPick(rec)}
              />
            ))}
          </ul>
        )}

        {!poolEmpty && !loading && !poolErrored && picks.length === 0 && (
          <div className="px-6 pt-10 text-center text-ink-400 text-sm">
            Every candidate in the pool is already on your list. Expand the
            pool to find new picks.
          </div>
        )}
      </div>
    </div>
  );
}

function RecRow({
  rec,
  rank,
  onSelect,
}: {
  rec: RankedPick;
  rank: number;
  onSelect: () => void;
}) {
  const topRank = rank <= 3;
  return (
    <li className="border-b border-ink-800/70">
      <button
        type="button"
        onClick={onSelect}
        className="w-full flex gap-3 px-4 py-3.5 text-left active:bg-ink-900 transition-colors"
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
        <div className="text-[9px] font-mono text-ink-500 tabular-nums tracking-wider">
          {rec.fitScore}
        </div>
      </div>

      <CandidatePoster rec={rec} />

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

        {(rec.studio || rec.awards) && (
          <div className="flex gap-2 flex-wrap text-[10.5px] text-ink-500 font-medium">
            {rec.studio && <span className="truncate">{rec.studio}</span>}
            {rec.studio && rec.awards && (
              <span className="opacity-50">·</span>
            )}
            {rec.awards && (
              <span className="text-amber-glow/85 truncate">
                {rec.awards}
              </span>
            )}
          </div>
        )}
        </div>
      </button>
    </li>
  );
}

function CandidatePoster({ rec }: { rec: Candidate }) {
  if (rec.poster) {
    return (
      <img
        src={rec.poster}
        alt=""
        className="w-[60px] h-[90px] rounded-md object-cover border border-ink-700 shrink-0 bg-ink-800"
        loading="lazy"
      />
    );
  }
  return (
    <div className="w-[60px] h-[90px] rounded-md bg-ink-800 border border-ink-700 shrink-0 flex items-center justify-center">
      <span className="text-xl font-bold text-ink-600 select-none">
        {rec.title.charAt(0).toUpperCase()}
      </span>
    </div>
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
        <div className="w-[60%] h-3 rounded bg-ink-800 shimmer" />
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : undefined}
    >
      <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" />
      <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </svg>
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

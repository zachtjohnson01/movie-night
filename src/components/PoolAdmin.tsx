import { scanPosterRepairs, applyPosterRepairs, type PosterRepairReport } from '../posterRepair';
import CatalogMovieCard from './CatalogMovieCard';
import ReleaseDate from './ReleaseDate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candidate, Movie } from '../types';
import {
  ageBadgeClass,
  candidateToTemplate,
  formatRelativeTime,
  formatRtScore,
  parseNameList,
} from '../format';
import {
  verifyAll,
  type VerifyField,
  type VerifyInput,
  type VerifyResult,
} from '../verify';
import type { CandidatePoolApi } from '../useCandidatePool';
import { scoreCandidate } from '../scoring';
import { expandPoolDetailed, extractUnique, type ExpandProgress, type ExpansionReport } from '../recommendations';
import {
  findDuplicateGroups,
  combineConfirmedDuplicates,
  applyMerge,
  pickDefaultSurvivor,
  conflictingIds,
  type DuplicateGroup,
} from '../dedupe';
import {
  commonSenseUrl,
  dedupKey,
  getMovieById,
  imdbUrl,
  OmdbError,
  rottenTomatoesUrl,
  type OmdbSearchResult,
} from '../omdb';
import {
  getStreamingByImdbId,
  hasStreamingProviders,
  isStreamingConfigured,
} from '../watchmode';
import type { StreamingInfo } from '../types';
import MoviePoster from './MoviePoster';
import StreamingSection from './StreamingSection';
import MovieSearchCombobox from './MovieSearchCombobox';
import StatLink from './StatLink';
import CreatorPills from './CreatorPills';

type Props = {
  pool: CandidatePoolApi;
  movies: Movie[];
  onBack: () => void;
};

// How many movies "Expand pool" asks for. Editable in the UI: smaller runs
// finish faster and cost fewer credits; larger ones try for more at once. The
// server enforces the same 10–100 range and its own time budget.
const EXPAND_MIN = 10;
const EXPAND_MAX = 100;
const EXPAND_DEFAULT = 30;
const EXPAND_COUNT_KEY = 'mn_expand_count';

const clampExpandCount = (n: number): number =>
  Math.max(EXPAND_MIN, Math.min(EXPAND_MAX, Math.round(n)));

function loadExpandCount(): number {
  try {
    const raw = localStorage.getItem(EXPAND_COUNT_KEY);
    const n = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) ? clampExpandCount(n) : EXPAND_DEFAULT;
  } catch {
    return EXPAND_DEFAULT;
  }
}

// Human-readable line for the current expansion stage, shown under the button
// so the multi-second run isn't a blind spinner.
function expandStageLabel(p: ExpandProgress): string {
  switch (p.stage) {
    case 'requesting':
      return 'Looking for new movies…';
    case 'enriching':
      return `Checking movie details — ${p.done}/${p.total} checked, ${p.kept} kept`;
    case 'saving':
      return 'Saving to the pool…';
    case 'done':
      return `Found ${p.added}`;
  }
}

type FilterKey = 'eligible' | 'missingLink' | 'duplicate' | 'tvShow' | 'removed';

const FILTER_ORDER: FilterKey[] = [
  'eligible',
  'missingLink',
  'duplicate',
  'tvShow',
  'removed',
];

const FILTER_LABEL: Record<FilterKey, string> = {
  eligible: 'Eligible',
  missingLink: 'Missing link',
  duplicate: 'Duplicates',
  tvShow: 'TV show',
  removed: 'Removed',
};

const VERIFY_FIELD_LABEL: Record<VerifyField, string> = {
  production: 'Studio',
  awards: 'Awards',
  year: 'Year',
  commonSenseAge: 'CSM Age',
  director: 'Director',
  writer: 'Writer',
};

/**
 * Admin-only screen: browse, edit, downvote, and remove candidates in the
 * pool. Sits on top of the tab-bar navigation (App.tsx screen stack),
 * reachable from the "Manage pool" button on the For You tab. Shows every
 * row in the pool by default — including unlinked / removed / low-signal
 * entries — so the admin can audit what's actually in row id=2. The
 * filter chip bar lets an admin narrow the view to rows matching any
 * selected problem (missing OMDB link, duplicate title, confirmed TV
 * show, already removed) or to the clean "eligible" subset.
 */
export default function PoolAdmin({ pool, movies, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [active, setActive] = useState<Set<FilterKey>>(new Set());
  const [expanding, setExpanding] = useState(false);
  const [comparison, setComparison] = useState<{ baseline?: ExpansionReport; enhanced?: ExpansionReport; baselineError?: string; enhancedError?: string; poolSize: number } | null>(null);
  const [lastReport, setLastReport] = useState<ExpansionReport | null>(null);
  const [comparing, setComparing] = useState(false);
  const [focus, setFocus] = useState('balanced');
  const [expandError, setExpandError] = useState<string | null>(null);
  const [expandProgress, setExpandProgress] = useState<ExpandProgress | null>(null);
  // How many movies to request per expansion (editable; persisted).
  const [expandCount, setExpandCount] = useState<number>(loadExpandCount);
  // Titles added by the most recent expansion, so the user can see exactly
  // what landed (empty array = ran but found nothing new).
  const [lastAdded, setLastAdded] = useState<string[] | null>(null);
  const [lastSkipped, setLastSkipped] = useState(0);
  const [duplicateScanTrigger, setDuplicateScanTrigger] = useState(0);
  const [sort, setSort] = useState<'fit' | 'title' | 'newest'>('fit');

  const adjustExpandCount = useCallback((next: number) => {
    setExpandCount(() => {
      const clamped = clampExpandCount(next);
      try {
        localStorage.setItem(EXPAND_COUNT_KEY, String(clamped));
      } catch {
        /* ignore storage errors */
      }
      return clamped;
    });
  }, []);

  const libraryTitles = useMemo(() => movies.map((m) => m.title), [movies]);
  const libraryDirectors = useMemo(
    () => extractUnique(movies.flatMap((m) => m.directors ?? [])),
    [movies],
  );
  const libraryWriters = useMemo(
    () => extractUnique(movies.flatMap((m) => m.writers ?? [])),
    [movies],
  );
  const libraryStudios = useMemo(
    () => extractUnique(movies.map((m) => m.production)),
    [movies],
  );

  const runExpansion = useCallback(async () => {
    if (expanding || (pool.status !== 'synced' && pool.status !== 'empty')) return;
    setExpandError(null);
    setLastAdded(null);
    setLastReport(null);
    setExpandProgress({ stage: 'requesting' });
    setExpanding(true);
    try {
      const report = await expandPoolDetailed(
        pool.candidates.map((c) => c.title),
        libraryTitles,
        expandCount,
        {
          directors: libraryDirectors,
          writers: libraryWriters,
          studios: libraryStudios,
        },
        setExpandProgress,
        { mode: 'enhanced', focus, existingMovies: [...pool.candidates, ...movies] },
      );
      setLastReport(report);
      const fresh = report.candidates;
      setExpandProgress({ stage: 'saving' });
      const added = fresh.length > 0 ? await pool.appendCandidates(fresh) : [];
      setLastAdded(added.map((c) => c.title));
      setLastSkipped(fresh.length - added.length);
      setDuplicateScanTrigger(value => value + 1);
    } catch (e) {
      setExpandError(e instanceof Error ? e.message : String(e));
    } finally {
      setExpanding(false);
      setExpandProgress(null);
    }
  }, [
    expanding,
    focus,
    movies,
    expandCount,
    pool,
    libraryTitles,
    libraryDirectors,
    libraryWriters,
    libraryStudios,
  ]);

  async function runComparison() {
    if (expanding || (pool.status !== 'synced' && pool.status !== 'empty')) return;
    setExpanding(true);
    setComparing(true);
    setExpandError(null);
    const snapshot = [...pool.candidates];
    const library = [...libraryTitles];
    const context = { directors: libraryDirectors, writers: libraryWriters, studios: libraryStudios };
    const result: NonNullable<typeof comparison> = { poolSize: snapshot.length };
    setComparison(result);
    try {
      for (const mode of ['baseline', 'enhanced'] as const) {
        try {
          result[mode] = await expandPoolDetailed(snapshot.map(c => c.title), library, expandCount, context, setExpandProgress,
            { mode, focus, existingMovies: [...snapshot, ...movies] });
        } catch (e) {
          result[mode === 'baseline' ? 'baselineError' : 'enhancedError'] = e instanceof Error ? e.message : String(e);
        }
        setComparison({ ...result });
      }
    } finally {
      setExpanding(false);
      setComparing(false);
      setExpandProgress(null);
    }
  }

  // Set of dedup keys that appear at least twice — used both for the
  // "Duplicates" filter chip and for the Eligible complement.
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of pool.candidates) {
      if (c.removedAt != null || c.removedReason != null) continue;
      const k = dedupKey(c.title);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const dups = new Set<string>();
    counts.forEach((n, k) => {
      if (n >= 2) dups.add(k);
    });
    return dups;
  }, [pool.candidates]);

  const classify = useCallback(
    (c: Candidate): Record<FilterKey, boolean> => {
      const missingLink = c.imdbId == null;
      const duplicate = duplicateKeys.has(dedupKey(c.title));
      const tvShow = c.type != null && c.type !== 'movie';
      const removed = c.removedAt != null || c.removedReason != null;
      const eligible =
        !missingLink && !duplicate && !tvShow && !removed;
      return { eligible, missingLink, duplicate, tvShow, removed };
    },
    [duplicateKeys],
  );

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = {
      eligible: 0,
      missingLink: 0,
      duplicate: 0,
      tvShow: 0,
      removed: 0,
    };
    for (const c of pool.candidates) {
      const cls = classify(c);
      for (const key of FILTER_ORDER) if (cls[key]) out[key] += 1;
    }
    return out;
  }, [pool.candidates, classify]);

  // Score and sort descending. Downvoted candidates sink via the 1000-point
  // penalty in scoreCandidate; removed candidates are shown in-place so the
  // admin sees them in context (sort is not a second removal signal).
  const ranked = useMemo(() => {
    const scored = pool.candidates.map((c, i) => ({
      c,
      i,
      fit: scoreCandidate(c, { knownDirectors: libraryDirectors, knownWriters: libraryWriters }, pool.weights),
    }));
    scored.sort((a, b) => {
      if (sort === 'title') return (a.c.displayTitle ?? a.c.title).localeCompare(b.c.displayTitle ?? b.c.title);
      if (sort === 'newest') return b.c.addedAt.localeCompare(a.c.addedAt) || a.i - b.i;
      return b.fit - a.fit || a.i - b.i;
    });
    return scored;
  }, [pool.candidates, sort, pool.weights, libraryDirectors, libraryWriters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const anyFilter = active.size > 0;
    return ranked.filter(({ c }) => {
      if (q && ![c.title, c.displayTitle, c.year, c.studio].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      if (!anyFilter) return true;
      const cls = classify(c);
      // OR semantics across chips: a row is kept if it matches any
      // selected filter. Eligible and the problem filters are complementary
      // sets, so toggling "Eligible + Missing link" gives you the union,
      // which is what you want when auditing "everything but TV shows".
      for (const key of active) if (cls[key]) return true;
      return false;
    });
  }, [ranked, query, active, classify]);

  const toggleFilter = useCallback((key: FilterKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="mx-auto max-w-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}>
      <header
        className="px-5 pb-4 bg-ink-950 border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-ink-200 active:bg-ink-800"
          >
            <svg
              viewBox="0 0 24 24"
              width={22}
              height={22}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Admin
            </div>
            <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight">
              Manage pool
            </h1>
            <p className="mt-1 text-sm text-ink-400">More possibilities for movie night.</p>
          </div>
        </div>


      </header>

      <section aria-label="Pool overview" className="grid grid-cols-3 gap-2 px-5 py-5">
        {[['In the pool', pool.candidates.length], ['Eligible', counts.eligible], ['Removed', counts.removed]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-ink-800 bg-ink-900 px-3 py-3">
            <div className="text-2xl font-bold tabular-nums text-ink-100">{value}</div>
            <div className="mt-1 text-xs text-ink-400">{label}</div>
          </div>
        ))}
      </section>

      <section aria-labelledby="expand-heading" className="mx-5 rounded-2xl border border-amber-glow/25 bg-ink-900 p-4 flex flex-col gap-3">
        <div>
          <h2 id="expand-heading" className="text-lg font-bold text-ink-100">Find something new</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-400">Discover movies to add to the shared pool.</p>
        </div>
        {!expanding && (
          <div className="flex items-center justify-between gap-3 pb-0.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Discovery target
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Fewer movies"
                onClick={() => adjustExpandCount(expandCount - 5)}
                disabled={expandCount <= EXPAND_MIN}
                className="w-11 h-11 rounded-xl bg-ink-800 border border-ink-700 text-xl leading-none text-ink-200 active:bg-ink-700 disabled:opacity-40"
              >
                −
              </button>
              <span className="w-10 text-center text-base font-bold tabular-nums text-ink-100">
                {expandCount}
              </span>
              <button
                type="button"
                aria-label="More movies"
                onClick={() => adjustExpandCount(expandCount + 5)}
                disabled={expandCount >= EXPAND_MAX}
                className="w-11 h-11 rounded-xl bg-ink-800 border border-ink-700 text-xl leading-none text-ink-200 active:bg-ink-700 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          disabled={expanding || (pool.status !== 'synced' && pool.status !== 'empty')}
          onClick={() => void runExpansion()}
          className={`w-full min-h-[52px] rounded-2xl text-base font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
            expanding
              ? 'bg-ink-800 border border-ink-700 text-ink-400 cursor-default'
              : 'bg-amber-glow text-ink-950 active:opacity-80'
          }`}
        >
          {expanding ? (
            <>
              <span
                aria-hidden
                className="inline-block w-3 h-3 rounded-full border-2 border-amber-glow border-t-transparent animate-spin"
              />
              {comparing ? 'Comparing methods…' : 'Expanding pool…'}
            </>
          ) : (
            <>Expand pool</>
          )}
        </button>

        <label className="text-sm text-ink-300">Discovery focus
          <select value={focus} onChange={e => setFocus(e.target.value)} disabled={expanding} className="mt-1 w-full h-[52px] rounded-xl border border-ink-700 bg-ink-950 px-3 text-base"><option value="balanced">Balanced catalog</option><option value="recent">Recent releases</option><option value="backfill">Backfill older movies</option></select>
        </label>
        <button type="button" disabled={expanding || (pool.status !== 'synced' && pool.status !== 'empty')} onClick={() => void runComparison()} className="min-h-[52px] rounded-xl border border-ink-700 bg-ink-800 text-sm font-semibold text-ink-200 disabled:opacity-50">Compare old vs new</button>
        <p className="text-xs text-ink-400">Comparison checks both methods against the same pool snapshot without saving movies. It uses two discovery runs.</p>
        {comparison && <div className="rounded-xl border border-ink-700 bg-ink-950 p-3 space-y-3" aria-label="Discovery comparison">
          <h3 className="font-semibold text-ink-100">Before and after discovery</h3>
          <p className="text-xs text-ink-400">Starting pool: {comparison.poolSize} rows. Candidates below have not been saved.</p>
          {(['baseline', 'enhanced'] as const).map(mode => <div key={mode}>
            <h4 className="text-sm font-semibold text-ink-200">{mode === 'baseline' ? 'Original method' : 'Enhanced method'}</h4>
            {comparison[mode] ? <ExpansionSummary report={comparison[mode]!} /> : <p className="text-sm text-ink-400">{comparison[mode === 'baseline' ? 'baselineError' : 'enhancedError'] ?? 'Waiting for results…'}</p>}
          </div>)}
          {comparison.baseline && comparison.enhanced && <p className="text-sm text-amber-glow">Difference: {comparison.enhanced.verified - comparison.baseline.verified} verified candidates. {comparison.enhanced.status === 'partial' || comparison.baseline.status === 'partial' ? 'Incomplete run: do not treat this as a final benchmark.' : 'A single run; results can vary.'}</p>}
        </div>}
        {lastReport && !expanding && <ExpansionSummary report={lastReport} />}
        <p className="text-xs leading-relaxed text-ink-400">Aim for up to {expandCount} movies. Actual additions depend on new matches.</p>

        {expanding && expandProgress && (
          <div className="flex flex-col gap-1.5 pt-0.5" role="status">
            <p className="text-center text-xs text-ink-300">
              {expandStageLabel(expandProgress)}
            </p>
            {expandProgress.stage === 'enriching' && (
              <div
                className="h-1 w-full rounded-full bg-ink-800 overflow-hidden"
                role="progressbar"
                aria-label="Movie details checked"
                aria-valuemin={0}
                aria-valuenow={expandProgress.done}
                aria-valuemax={expandProgress.total}
              >
                <div
                  className="h-full bg-amber-glow transition-[width] duration-200"
                  style={{
                    width: `${
                      expandProgress.total
                        ? (expandProgress.done / expandProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {expandError && (
          <p role="alert" className="rounded-xl border border-crimson-deep/60 bg-crimson-deep/10 p-3 text-sm text-crimson-bright">
            {expandError}
          </p>
        )}

        {!expanding && lastAdded !== null && (
          <div role="status" className="rounded-xl border border-ink-700 bg-ink-950 p-3">
            <p className="text-sm font-semibold text-ink-100">
              {lastAdded.length > 0 ? `Added ${lastAdded.length} movie${lastAdded.length === 1 ? '' : 's'} to the pool` : 'No new movies added this time'}
            </p>
            {lastSkipped > 0 && <p className="mt-1 text-sm text-ink-400">{lastSkipped} existing or duplicate matches skipped at save.</p>}
            {lastAdded.length > 0 ? (
              <details className="mt-1">
                <summary className="min-h-[44px] flex items-center cursor-pointer text-sm font-semibold text-amber-glow">See added movies</summary>
                <ul className="space-y-1 text-sm text-ink-300 break-words">{lastAdded.map((title) => <li key={title}>{title}</li>)}</ul>
              </details>
            ) : <p className="mt-1 text-sm text-ink-400">Try another batch to look for different matches.</p>}
          </div>
        )}
      </section>

      <details className="mx-5 mt-3 rounded-2xl border border-ink-800 bg-ink-900">
        <summary className="min-h-[52px] cursor-pointer px-4 py-3 text-sm font-semibold text-ink-200">Update &amp; tidy the pool</summary>
        <p className="px-4 text-sm leading-relaxed text-ink-400">Refresh details and availability for existing titles, or review duplicates.</p>
        <fieldset disabled={expanding} className="pb-3 disabled:opacity-50">
          <BulkOmdbSection pool={pool} />
          <PosterRepairSection pool={pool} onEdit={setEditing} />
          <BulkStreamingSection pool={pool} />
          <FindDuplicatesSection pool={pool} movies={movies} scanTrigger={duplicateScanTrigger} />
        </fieldset>
      </details>

      <section aria-label="Browse pool" className="mt-5">
        <div className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/95 backdrop-blur-lg border-y border-ink-800/60" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <div className="mt-3 relative">
          <input
            type="search"
            inputMode="search"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Search pool"
            placeholder="Search title, year or studio…"
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

        <div className="mt-3 -mx-5 px-5 flex gap-2 overflow-x-auto pb-1">
          <button type="button" aria-pressed={active.size === 0} onClick={() => setActive(new Set())}
            className={`shrink-0 min-h-[44px] px-4 rounded-full text-xs font-semibold border ${active.size === 0 ? 'bg-amber-glow text-ink-950 border-amber-glow' : 'bg-ink-800 text-ink-300 border-ink-700'}`}>All</button>
          {FILTER_ORDER.map((key) => {
            const isActive = active.has(key);
            const n = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFilter(key)}
                aria-pressed={isActive}
                className={`shrink-0 min-h-[44px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  isActive
                    ? 'bg-amber-glow text-ink-950 border-amber-glow'
                    : 'bg-ink-800 border-ink-700 text-ink-300 active:bg-ink-700'
                }`}
              >
                <span>{FILTER_LABEL[key]}</span>
                <span
                  className={`text-[10px] font-mono tabular-nums ${
                    isActive ? 'text-ink-950/70' : 'text-ink-500'
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <p className="text-sm text-ink-400" role="status">{visible.length} of {pool.candidates.length} titles</p>
          <label className="flex items-center gap-2 text-sm text-ink-400">
            Sort
            <select aria-label="Sort movies" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="min-h-[44px] max-w-[180px] rounded-xl border border-ink-700 bg-ink-900 px-3 text-base text-ink-200">
              <option value="fit">Best fit</option><option value="newest">Recently added</option><option value="title">Title A–Z</option>
            </select>
          </label>
        </div>
        {pool.status === 'loading' && <p role="status" className="px-5 py-8 text-sm text-ink-300">Loading the pool…</p>}
        {pool.status === 'error' && <div role="alert" className="mx-5 rounded-xl border border-crimson-deep p-4 text-sm text-ink-200">The pool could not sync. These results may be out of date.<button type="button" onClick={pool.reload} className="mt-2 block min-h-[44px] font-semibold text-amber-glow">Try syncing again</button></div>}
        <ul className="space-y-2 px-5">
          {visible.map(({ c, fit }, i) => (
            <PoolRow key={`${c.imdbId ?? c.title}-${i}`} c={c} fit={fit} rank={i + 1}
              onEdit={() => setEditing(c)} onToggleDownvote={() => void pool.toggleDownvote(c.title)} />
          ))}
        </ul>
        {visible.length === 0 && pool.status !== 'loading' && pool.status !== 'error' && (
          <div className="mx-5 rounded-2xl border border-dashed border-ink-700 px-5 py-8 text-center">
            <p className="font-semibold text-ink-200">{query || active.size > 0 ? 'No matching movies' : 'A world of movies starts here'}</p>
            <p className="mt-2 text-sm text-ink-400">{query || active.size > 0 ? 'Try a different search or clear your filters.' : 'Use Expand pool to discover the first titles.'}</p>
            {(query || active.size > 0) && <button type="button" onClick={() => { setQuery(''); setActive(new Set()); }} className="mt-3 min-h-[44px] px-4 text-sm font-semibold text-amber-glow">Clear search and filters</button>}
          </div>
        )}
      </section>

      {editing && (
        <EditSheet
          candidate={editing}
          reasons={pool.reasons}
          onClose={() => setEditing(null)}
          onSave={async (updated) => {
            await pool.updateCandidate(editing.title, updated);
            setEditing(null);
          }}
          onRemove={async (reason) => {
            await pool.removeCandidate(editing.title, reason);
            setEditing(null);
          }}
          onRestore={async () => {
            await pool.restoreCandidate(editing.title);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PoolRow({
  c,
  fit,
  rank,
  onEdit,
  onToggleDownvote,
}: {
  c: Candidate;
  fit: number;
  rank: number;
  onEdit: () => void;
  onToggleDownvote: () => void;
}) {
  const downvoted = !!c.downvoted;
  const removed = c.removedAt != null || c.removedReason != null;
  return (
    <li className="rounded-2xl border border-ink-800 bg-ink-900 overflow-hidden">
      <div className={`flex items-start gap-1 px-2 ${downvoted || removed ? 'opacity-60' : ''}`}>
        <div className="min-w-0 flex-1">
          <CatalogMovieCard movie={candidateToTemplate(c)} onSelect={onEdit} ariaLabel={`Edit ${c.displayTitle ?? c.title}`} />
        </div>
        <button
          type="button"
          onClick={onToggleDownvote}
          aria-label={`${downvoted ? 'Remove downvote for' : 'Downvote'} ${c.displayTitle ?? c.title}`}
          aria-pressed={downvoted}
          title="Downvoting lowers recommendation rank; it does not remove the movie."
          className={`shrink-0 mt-3 w-11 h-11 rounded-full flex items-center justify-center border transition-colors ${
            downvoted
              ? 'bg-crimson-deep/20 border-crimson-deep text-crimson-bright'
              : 'bg-ink-800 border-ink-700 text-ink-400 active:bg-ink-700'
          }`}
        >
          <ThumbsDownIcon filled={downvoted} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-800 px-4 py-2 text-xs text-ink-400">
        <span>#{rank} · Fit {fit}</span>
        {removed && <span className="text-crimson-bright">Removed{c.removedReason ? `: ${c.removedReason}` : ''}</span>}
        {downvoted && !removed && <span className="text-crimson-bright">Downvoted</span>}
      </div>
    </li>
  );
}

function EditSheet({
  candidate,
  reasons,
  onSave,
  onRemove,
  onRestore,
  onClose,
}: {
  candidate: Candidate;
  reasons: string[];
  onSave: (updated: Candidate) => Promise<void>;
  onRemove: (reason: string) => Promise<void>;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(candidate.title);
  const [displayTitleInput, setDisplayTitleInput] = useState(
    candidate.displayTitle ?? '',
  );
  const [yearStr, setYearStr] = useState(
    candidate.year != null ? String(candidate.year) : '',
  );
  const [releaseDate, setReleaseDate] = useState(candidate.releaseDate ?? null);
  const [age, setAge] = useState(candidate.commonSenseAge ?? '');
  const [studio, setStudio] = useState(candidate.studio ?? '');
  const [imdbIdInput, setImdbIdInput] = useState(candidate.imdbId ?? '');
  const [rtIdInput, setRtIdInput] = useState(candidate.rottenTomatoesId ?? '');
  // Mirror OMDB-derived read-only fields locally so a search-result pick
  // can update them in-place before save (header poster, RT/IMDb stat
  // chips, awards readout). On save we persist them back into the
  // candidate; without this state the only way to refresh them was the
  // bulk re-enrichment path.
  const [rt, setRt] = useState<string | null>(candidate.rottenTomatoes ?? null);
  const [imdb, setImdb] = useState<string | null>(candidate.imdb ?? null);
  const [awards, setAwards] = useState<string | null>(candidate.awards ?? null);
  const [poster, setPoster] = useState<string | null>(candidate.poster ?? null);
  const [type, setType] = useState<string | null>(candidate.type ?? null);
  const [directors, setDirectors] = useState<string[] | null>(
    candidate.directors ?? null,
  );
  const [writers, setWriters] = useState<string[] | null>(
    candidate.writers ?? null,
  );
  const [pickBusy, setPickBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(
    candidate.omdbRefreshedAt ?? null,
  );
  const [streaming, setStreaming] = useState<StreamingInfo | null>(
    candidate.streaming ?? null,
  );
  const [streamingBusy, setStreamingBusy] = useState(false);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyProgress, setVerifyProgress] = useState({ done: 0, total: 0 });
  // null = haven't run; [] = ran, nothing to change; non-empty = proposed edits
  const [verifySuggestions, setVerifySuggestions] = useState<
    VerifyResult[] | null
  >(null);
  const [customReason, setCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyReason, setBusyReason] = useState<string | null>(null);

  const isRemoved = candidate.removedAt != null;

  // Picking an OMDB search result re-links the whole candidate: title,
  // imdbId, year, studio, plus the read-only metric fields all overwrite
  // to the picked movie's values. The Rotten Tomatoes URL slug
  // (rottenTomatoesId) is cleared because OMDB doesn't expose it and
  // keeping the previous slug would silently deep-link to the wrong
  // film. Mirrors handlePickSearchResult in Detail.tsx for the Movie
  // flow.
  async function handlePick(result: OmdbSearchResult) {
    setPickBusy(true);
    setPickError(null);
    try {
      const patch = await getMovieById(result.imdbId);
      setTitle(patch.title);
      setDisplayTitleInput('');
      setReleaseDate(patch.releaseDate ?? null);
      setYearStr(patch.year != null ? String(patch.year) : '');
      setImdbIdInput(patch.imdbId);
      setRtIdInput('');
      setStudio(patch.production ?? '');
      setRt(patch.rottenTomatoes);
      setImdb(patch.imdb);
      setAwards(patch.awards);
      setPoster(patch.poster);
      setType(patch.type);
      setDirectors(patch.directors);
      setWriters(patch.writers);
      // Re-linking points at a different film; the old availability snapshot
      // no longer applies. Clear it so it gets re-resolved.
      setStreaming(null);
    } catch (e) {
      setPickError(
        e instanceof OmdbError
          ? e.message
          : (e as Error).message || 'Failed to load from OMDB',
      );
    } finally {
      setPickBusy(false);
    }
  }

  // One-off OMDB refresh for THIS candidate, reusing its existing IMDb ID
  // instead of making the admin re-search. Mirrors the bulk bulkRefreshOmdb
  // merge semantics: fresh OMDB values fill in, but a null from OMDB never
  // wipes an existing value — so a manually-entered RT/IMDb fallback (the
  // foreign / small streaming-film case, e.g. titles OMDB has no critics
  // score for) survives a refresh that comes back empty. Title, display
  // title, CSM age, and the RT slug are deliberately left untouched.
  async function handleRefresh() {
    const id = imdbIdInput.trim();
    if (!id || refreshBusy) return;
    setRefreshBusy(true);
    setRefreshError(null);
    try {
      const patch = await getMovieById(id);
      setReleaseDate(patch.releaseDate ?? null);
      setYearStr(patch.year != null ? String(patch.year) : yearStr);
      setStudio(patch.production ?? studio);
      setRt(patch.rottenTomatoes ?? rt);
      setImdb(patch.imdb ?? imdb);
      setAwards(patch.awards ?? awards);
      setPoster(patch.poster ?? poster);
      setType(patch.type ?? type);
      setDirectors(patch.directors ?? directors);
      setWriters(patch.writers ?? writers);
      setRefreshedAt(new Date().toISOString());
    } catch (e) {
      setRefreshError(
        e instanceof OmdbError
          ? e.message
          : (e as Error).message || 'Failed to refresh from OMDB',
      );
    } finally {
      setRefreshBusy(false);
    }
  }

  // One-off Watchmode streaming refresh for THIS candidate, reusing its IMDb
  // ID. Overwrites the cached `streaming` snapshot (providers change over time,
  // so this is a replace, not a fill). Writes to local state only; the admin
  // taps Save to persist, same as every other field in this sheet.
  async function handleRefreshStreaming() {
    const id = imdbIdInput.trim();
    if (!id || streamingBusy) return;
    setStreamingBusy(true);
    setStreamingError(null);
    try {
      setStreaming(await getStreamingByImdbId(id));
    } catch (e) {
      setStreamingError(
        (e as Error).message || 'Failed to refresh streaming from Watchmode',
      );
    } finally {
      setStreamingBusy(false);
    }
  }

  // Run Claude across every verifiable field for this candidate. OMDB refresh
  // covers ratings / poster / studio; this covers the fields OMDB can't —
  // notably the Common Sense age, plus year / director / writer / awards.
  // Suggestions write to local state only; the admin still taps Save to
  // persist, same as every other field in this sheet.
  async function handleVerifyAll() {
    if (verifyBusy) return;
    setVerifyBusy(true);
    setVerifyError(null);
    setVerifySuggestions(null);
    const parsedYear = yearStr.trim() ? parseInt(yearStr, 10) : NaN;
    const input: VerifyInput = {
      title: title.trim() || candidate.title,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      imdbId: imdbIdInput.trim() || null,
      production: studio.trim() || null,
      awards,
      commonSenseAge: age.trim() || null,
      directors,
      writers,
    };
    try {
      const results = await verifyAll(input, (done, total) =>
        setVerifyProgress({ done, total }),
      );
      // Keep only confident suggestions that actually differ from what's stored.
      setVerifySuggestions(
        results.filter(
          (r) => r.field != null && r.suggestedValue != null && !r.matches,
        ),
      );
    } catch (e) {
      setVerifyError((e as Error).message || 'Failed to verify with Claude');
    } finally {
      setVerifyBusy(false);
    }
  }

  function currentValueFor(field: VerifyField): string | null {
    switch (field) {
      case 'production':
        return studio.trim() || null;
      case 'awards':
        return awards;
      case 'year':
        return yearStr.trim() || null;
      case 'commonSenseAge':
        return age.trim() || null;
      case 'director':
        return directors && directors.length > 0 ? directors.join(', ') : null;
      case 'writer':
        return writers && writers.length > 0 ? writers.join(', ') : null;
    }
  }

  function applyVerifyField(r: VerifyResult) {
    if (r.field == null || r.suggestedValue == null) return;
    switch (r.field) {
      case 'production':
        setStudio(r.suggestedValue);
        break;
      case 'awards':
        setAwards(r.suggestedValue);
        break;
      case 'year': {
        const n = parseInt(r.suggestedValue, 10);
        if (Number.isFinite(n)) setYearStr(String(n));
        break;
      }
      case 'commonSenseAge':
        setAge(r.suggestedValue);
        break;
      case 'director':
        setDirectors(parseNameList(r.suggestedValue));
        break;
      case 'writer':
        setWriters(parseNameList(r.suggestedValue));
        break;
    }
  }

  function applyVerifySuggestion(r: VerifyResult) {
    applyVerifyField(r);
    setVerifySuggestions((prev) => (prev ? prev.filter((x) => x !== r) : prev));
  }

  function applyAllVerifySuggestions() {
    if (!verifySuggestions) return;
    verifySuggestions.forEach(applyVerifyField);
    setVerifySuggestions([]);
  }

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const parsedYear = yearStr.trim() ? parseInt(yearStr, 10) : NaN;
    const trimmedId = imdbIdInput.trim();
    const trimmedRtId = rtIdInput.trim();
    await onSave({
      ...candidate,
      title: title.trim() || candidate.title,
      displayTitle: displayTitleInput.trim() || null,
      releaseDate,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      commonSenseAge: age.trim() || null,
      studio: studio.trim() || null,
      imdbId: trimmedId ? trimmedId : null,
      rottenTomatoesId: trimmedRtId ? trimmedRtId : null,
      rottenTomatoes: formatRtScore(rt),
      imdb,
      awards,
      poster,
      type,
      directors: directors && directors.length > 0 ? directors : null,
      writers: writers && writers.length > 0 ? writers : null,
      omdbRefreshedAt: refreshedAt,
      streaming,
    });
  };

  const handleRemove = async (reason: string) => {
    const trimmed = reason.trim();
    if (!trimmed || busyReason) return;
    setBusyReason(trimmed);
    try {
      await onRemove(trimmed);
    } finally {
      setBusyReason(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-ink-950/80 backdrop-blur-sm flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-auto rounded-t-3xl bg-ink-900 border-t border-ink-700 p-5 max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink-100">Candidate</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-ink-300 active:bg-ink-800"
          >
            <svg
              viewBox="0 0 24 24"
              width={20}
              height={20}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-start gap-4 mb-4">
          <MoviePoster
            movie={{
              title,
              displayTitle: displayTitleInput.trim() || null,
              poster,
            }}
            size="detail"
          />
          <div className="flex-1 min-w-0 pt-1">
            <h3 className="text-xl font-bold leading-tight tracking-tight text-ink-100">
              {title}
            </h3>
            {yearStr && (
              <div className="mt-1 text-sm font-semibold text-ink-400 tabular-nums">
                {yearStr}
              </div>
            )}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <StatLink
            label="CSM Age"
            value={age || null}
            href={commonSenseUrl({
              title,
              displayTitle: displayTitleInput.trim() || null,
            })}
            accent="age"
          />
          <StatLink
            label="RT"
            value={rt}
            href={rottenTomatoesUrl({
              title,
              displayTitle: displayTitleInput.trim() || null,
              rottenTomatoesId: rtIdInput.trim() || null,
            })}
          />
          <StatLink
            label="IMDb"
            value={imdb}
            href={imdbUrl({
              title,
              displayTitle: displayTitleInput.trim() || null,
              imdbId: imdbIdInput.trim() || null,
            })}
          />
        </div>

        <ReleaseDate releaseDate={releaseDate} />
        {imdbIdInput.trim() && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshBusy}
              className="w-full min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {refreshBusy ? 'Refreshing…' : 'Refresh from OMDB'}
            </button>
            {refreshError ? (
              <p className="mt-1.5 text-[11px] text-crimson-bright">
                {refreshError}
              </p>
            ) : (
              refreshedAt && (
                <p className="mt-1.5 text-center text-[11px] text-ink-500">
                  Last refreshed {formatRelativeTime(refreshedAt)}
                </p>
              )
            )}
          </div>
        )}

        {isStreamingConfigured && imdbIdInput.trim() && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => void handleRefreshStreaming()}
              disabled={streamingBusy}
              className="w-full min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {streamingBusy ? 'Refreshing…' : 'Update where to watch'}
            </button>
            {streamingError ? (
              <p className="mt-1.5 text-[11px] text-crimson-bright">
                {streamingError}
              </p>
            ) : hasStreamingProviders(streaming) ? (
              <>
                <StreamingSection
                  streaming={streaming}
                  searchTitle={displayTitleInput.trim() || title}
                  className="mt-3"
                />
                {streaming!.fetchedAt && (
                  <p className="mt-1.5 text-center text-[11px] text-ink-500">
                    Refreshed {formatRelativeTime(streaming!.fetchedAt)}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-center text-[11px] text-ink-500">
                {streaming ? 'No US providers found' : 'Not checked yet'}
              </p>
            )}
          </div>
        )}

        <div className="mb-4">
          <button
            type="button"
            onClick={() => void handleVerifyAll()}
            disabled={verifyBusy}
            className="w-full min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {verifyBusy
              ? `Verifying… ${verifyProgress.done}/${verifyProgress.total}`
              : 'Verify all data with Claude'}
          </button>
          {verifyError && (
            <p className="mt-1.5 text-[11px] text-crimson-bright">
              {verifyError}
            </p>
          )}
          {verifySuggestions &&
            verifySuggestions.length === 0 &&
            !verifyError && (
              <p className="mt-1.5 text-center text-[11px] text-ink-500">
                Claude found nothing to change.
              </p>
            )}
          {verifySuggestions && verifySuggestions.length > 0 && (
            <div className="mt-2 space-y-2">
              {verifySuggestions.map((r, idx) => {
                const field = r.field as VerifyField;
                return (
                  <div
                    key={`${field}-${idx}`}
                    className="rounded-xl bg-ink-800/70 border border-ink-700 p-3"
                  >
                    <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                      {VERIFY_FIELD_LABEL[field]}
                    </div>
                    <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-ink-500">Now</span>
                      <span className="text-ink-300">
                        {currentValueFor(field) ?? (
                          <span className="italic text-ink-600">blank</span>
                        )}
                      </span>
                      <span className="text-ink-500">Claude</span>
                      <span className="text-amber-glow font-semibold">
                        {r.suggestedValue}
                      </span>
                    </div>
                    {r.explanation && (
                      <p className="mt-1 text-[11px] text-ink-500 leading-snug">
                        {r.explanation}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => applyVerifySuggestion(r)}
                      className="mt-2 w-full min-h-[44px] rounded-xl bg-ink-800 border border-ink-700 text-xs font-semibold text-ink-100 active:bg-ink-700"
                    >
                      Apply
                    </button>
                  </div>
                );
              })}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVerifySuggestions(null)}
                  className="min-h-[44px] rounded-xl bg-ink-800 border border-ink-700 text-xs font-semibold text-ink-300 active:bg-ink-700"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={applyAllVerifySuggestions}
                  className="min-h-[44px] rounded-xl bg-amber-glow text-ink-950 text-xs font-bold active:opacity-80"
                >
                  Apply all
                </button>
              </div>
              <p className="text-center text-[11px] text-ink-500">
                Applied changes are staged — tap Save to persist.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Title">
            <MovieSearchCombobox
              value={title}
              onChange={setTitle}
              onPick={handlePick}
            />
            {pickBusy && (
              <p className="text-[11px] text-ink-500">Loading from OMDB…</p>
            )}
            {pickError && (
              <p className="text-[11px] text-crimson-bright">{pickError}</p>
            )}
          </Field>
          <Field label="Display title">
            <input
              type="text"
              value={displayTitleInput}
              onChange={(e) => setDisplayTitleInput(e.target.value)}
              autoCorrect="off"
              placeholder="e.g. Lotte from Gadgetville"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
            />
            <p className="text-[11px] text-ink-500 mt-1 leading-snug">
              Human-readable override. Used everywhere the movie name is rendered when set.
            </p>
          </Field>
          <Field label="Year">
            <input
              type="text"
              inputMode="numeric"
              value={yearStr}
              onChange={(e) => setYearStr(e.target.value)}
              autoCorrect="off"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 focus:outline-none focus:border-amber-glow/60"
            />
          </Field>
          <Field label="Common Sense age">
            <input
              type="text"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              autoCorrect="off"
              placeholder="e.g. 7+"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
            />
          </Field>
          <Field label="Studio">
            <input
              type="text"
              value={studio}
              onChange={(e) => setStudio(e.target.value)}
              autoCorrect="off"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 focus:outline-none focus:border-amber-glow/60"
            />
          </Field>
          <Field label="Directors">
            <CreatorPills
              names={directors}
              onChange={setDirectors}
              placeholder="Add director (comma-separates multiple)"
            />
          </Field>
          <Field label="Writers">
            <CreatorPills
              names={writers}
              onChange={setWriters}
              placeholder="Add writer (comma-separates multiple)"
            />
          </Field>
          <Field label="IMDb ID">
            <input
              type="text"
              value={imdbIdInput}
              onChange={(e) => setImdbIdInput(e.target.value)}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="tt0096283"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
            />
          </Field>
          <Field label="Rotten Tomatoes ID">
            <input
              type="text"
              value={rtIdInput}
              onChange={(e) => setRtIdInput(e.target.value)}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. toy_story_1995"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
            />
          </Field>
          <Field label="RT score">
            <input
              type="text"
              inputMode="numeric"
              value={rt ?? ''}
              onChange={(e) =>
                setRt(e.target.value.trim() === '' ? null : e.target.value)
              }
              onBlur={() => setRt((v) => formatRtScore(v))}
              autoCorrect="off"
              autoCapitalize="none"
              placeholder="e.g. 84%"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
            />
            <p className="text-[11px] text-ink-500 mt-1 leading-snug">
              Critics score. Leave blank to let OMDB fill it; a manual value is overwritten if OMDB later returns one. A bare number is saved as a percentage.
            </p>
          </Field>
          <Field label="IMDb score">
            <input
              type="text"
              inputMode="decimal"
              value={imdb ?? ''}
              onChange={(e) =>
                setImdb(e.target.value.trim() === '' ? null : e.target.value)
              }
              autoCorrect="off"
              autoCapitalize="none"
              placeholder="e.g. 7.4"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
            />
            <p className="text-[11px] text-ink-500 mt-1 leading-snug">
              Rating out of 10. Leave blank to let OMDB fill it; overwritten if OMDB later returns one.
            </p>
          </Field>
        </div>

        <div className="mt-4 pt-4 border-t border-ink-800 text-[11px] text-ink-500 leading-relaxed space-y-0.5">
          <ReadOnly label="RT" value={rt} />
          <ReadOnly label="IMDb" value={imdb} />
          <ReadOnly label="Awards" value={awards} />
        </div>

        <div className="mt-5 pt-4 border-t border-ink-800">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500 mb-2">
            Remove from pool
          </div>
          {isRemoved ? (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-crimson-deep/10 border border-crimson-deep/40">
              <div className="flex-1 text-xs text-ink-300 leading-relaxed">
                Currently removed
                {candidate.removedReason ? (
                  <>
                    {' '}— reason:{' '}
                    <span className="text-crimson-bright font-semibold">
                      {candidate.removedReason}
                    </span>
                  </>
                ) : (
                  '.'
                )}
              </div>
              <button
                type="button"
                onClick={() => void onRestore()}
                className="shrink-0 min-h-[44px] px-4 rounded-xl text-xs font-semibold bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700"
              >
                Restore
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {reasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => void handleRemove(r)}
                    disabled={busyReason != null}
                    className={`min-h-[44px] px-3 rounded-full text-xs font-semibold border transition-colors ${
                      busyReason === r
                        ? 'bg-ink-700 border-ink-600 text-ink-400 cursor-default'
                        : 'bg-ink-800 border-ink-700 text-ink-200 active:bg-ink-700'
                    }`}
                  >
                    {busyReason === r ? 'Removing…' : r}
                  </button>
                ))}
                {reasons.length === 0 && (
                  <p className="text-[11px] text-ink-500 italic">
                    No saved reasons yet — type one below.
                  </p>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  autoCorrect="off"
                  placeholder="Add new reason…"
                  className="flex-1 h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const r = customReason.trim();
                    if (!r) return;
                    await handleRemove(r);
                    setCustomReason('');
                  }}
                  disabled={!customReason.trim() || busyReason != null}
                  className="shrink-0 min-h-[44px] px-4 rounded-xl text-sm font-bold bg-crimson-deep text-ink-100 active:opacity-80 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-2xl text-sm font-semibold bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-2xl text-sm font-bold bg-amber-glow text-ink-950 active:opacity-80 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ink-500">
        {label}
      </span>
      {children}
    </label>
  );
}

// Duplicate finder: scans the pool for candidates that collide on title
// key and/or IMDb id, then walks the admin through each group one at a time
// (records shown side by side) to fold the extras into a single survivor.
// Mirrors the idle-button pattern of BulkOmdbSection/BulkStreamingSection.
function FindDuplicatesSection({
  pool,
  movies,
  scanTrigger = 0,
}: {
  pool: CandidatePoolApi;
  movies: Movie[];
  scanTrigger?: number;
}) {
  // Snapshot the groups when the review opens so merges made mid-review don't
  // reshuffle the stepper under the admin. `null` = closed.
  const [session, setSession] = useState<DuplicateGroup[] | null>(null);

  const groups = useMemo(
    () => findDuplicateGroups(pool.candidates),
    [pool.candidates],
  );

  const isInLibrary = useMemo(() => {
    const ids = new Set(
      movies.map((m) => m.imdbId).filter((x): x is string => x != null),
    );
    const keys = new Set(movies.map((m) => dedupKey(m.title)));
    return (c: Candidate) =>
      (c.imdbId != null && ids.has(c.imdbId)) || keys.has(dedupKey(c.title));
  }, [movies]);

  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const handledTrigger = useRef(0);
  const busyScan = useRef(false);
  const runScan = useCallback(async (openReview: boolean) => {
    if (busyScan.current) return;
    busyScan.current = true;
    setScanning(true);
    setScanError(null);
    try {
      let next = pool.candidates;
      let combined = 0;
      const preview = combineConfirmedDuplicates(next, isInLibrary);
      if (preview.combined > 0) {
        await pool.replaceCandidates(current => {
          const result = combineConfirmedDuplicates(current, isInLibrary);
          next = result.candidates;
          combined = result.combined;
          return next;
        });
      }
      const remaining = findDuplicateGroups(next);
      setScanMessage(`${combined} confirmed duplicate ${combined === 1 ? 'record combined' : 'records combined'} · ${remaining.length} ${remaining.length === 1 ? 'group needs' : 'groups need'} review`);
      if (openReview || remaining.length > 0) setSession(remaining);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Duplicate scan could not be saved.');
    } finally { busyScan.current = false; setScanning(false); }
  }, [pool, isInLibrary]);
  useEffect(() => {
    if (scanTrigger === 0 || handledTrigger.current === scanTrigger) return;
    handledTrigger.current = scanTrigger;
    void runScan(false);
  }, [scanTrigger, runScan]);

  const count = groups.length;

  return (
    <div className="px-4 pt-1 pb-2">
      <button
        type="button"
        onClick={() => void runScan(true)}
        disabled={scanning}
        aria-label={`Find duplicates, ${count} ${
          count === 1 ? 'group' : 'groups'
        }`}
        className={`w-full min-h-[48px] rounded-2xl border text-sm font-semibold flex items-center justify-center gap-2 active:bg-ink-700 transition-colors ${
          count > 0
            ? 'bg-ink-800 border-amber-glow/40 text-ink-100'
            : 'bg-ink-800 border-ink-700 text-ink-200'
        }`}
      >
        <LayersIcon
          className={`w-[18px] h-[18px] shrink-0 ${
            count > 0 ? 'text-amber-glow' : 'text-ink-500'
          }`}
        />
        <span>{scanning ? 'Scanning duplicates…' : 'Find duplicates'}</span>
        <span
          className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums ${
            count > 0 ? 'bg-amber-glow text-ink-950' : 'bg-ink-700 text-ink-400'
          }`}
        >
          {count}
        </span>
      </button>

      {scanMessage && <p className="mt-2 text-xs text-ink-400" role="status">{scanMessage}</p>}
      {scanError && <p className="mt-2 text-sm text-crimson-bright" role="alert">{scanError}</p>}
      {session && (
        <DuplicateReview
          groups={session}
          isInLibrary={isInLibrary}
          onMerge={(keeper, victims) =>
            pool.replaceCandidates(
              current => applyMerge(current, keeper, victims),
            )
          }
          onClose={() => setSession(null)}
        />
      )}
    </div>
  );
}

// Full-screen review stepper. Presents one duplicate group at a time with its
// members side by side; the admin taps the record to keep and merges the rest
// in, or skips the group. Merging fills the survivor's empty metadata from the
// others and drops the extra rows (see src/dedupe.ts).
function DuplicateReview({
  groups,
  isInLibrary,
  onMerge,
  onClose,
}: {
  groups: DuplicateGroup[];
  isInLibrary: (c: Candidate) => boolean;
  onMerge: (keeper: Candidate, victims: Candidate[]) => Promise<void>;
  onClose: () => void;
}) {
  const total = groups.length;
  const [index, setIndex] = useState(0);
  const [keeperIdx, setKeeperIdx] = useState(() =>
    total > 0 ? pickDefaultSurvivor(groups[0].members, isInLibrary) : 0,
  );
  // Member indices the admin chose to leave OUT of the merge (only relevant
  // for groups with 3+ members — the leftover stays as its own pool row).
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [merged, setMerged] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const done = index >= total;
  const group = done ? null : groups[index];

  const advance = useCallback(
    (next: number) => {
      setError(null);
      setExcluded(new Set());
      if (next < groups.length) {
        setKeeperIdx(pickDefaultSurvivor(groups[next].members, isInLibrary));
      }
      setIndex(next);
    },
    [groups, isInLibrary],
  );

  // Choosing a new keeper resets the include/exclude selection — the roles
  // shift, so default back to "merge in everything else".
  const selectKeeper = useCallback((i: number) => {
    setKeeperIdx(i);
    setExcluded(prev => { const next = new Set(prev); next.delete(i); return next; });
  }, []);

  const toggleExclude = (i: number) => {
    const next = new Set(excluded);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    if (i === keeperIdx && next.has(i) && group) {
      const replacement = group.members.findIndex((_, memberIndex) => !next.has(memberIndex));
      if (replacement >= 0) setKeeperIdx(replacement);
    }
    setExcluded(next);
  };

  const keeper = group && !excluded.has(keeperIdx) ? group.members[keeperIdx] : null;
  const victims = group
    ? group.members.filter((_, i) => i !== keeperIdx && !excluded.has(i))
    : [];

  // How many of the folded-in rows are referenced by a watched/wishlist movie.
  // Merging never orphans them — applyMerge soft-removes victims and
  // findCandidate still resolves soft-removed rows — but it's worth telling the
  // admin which ones are in a list before they merge.
  const libraryVictims = victims.filter(isInLibrary);

  // Loud guard against a FALSE-positive merge (the "Shaun the Sheep" bug: the
  // 2015 film and the 2019 sequel got merged). See dedupe.conflictingIds.
  const idConflicts = keeper ? conflictingIds(keeper, victims) : [];
  const conflictInLibrary =
    idConflicts.length > 0 &&
    (idConflicts.some(isInLibrary) || (keeper != null && isInLibrary(keeper)));

  async function handleMerge() {
    if (!group || !keeper || busy) return;
    setBusy(true);
    try {
      await onMerge(keeper, victims);
      setMerged((n) => n + 1);
      advance(index + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    setSkipped((n) => n + 1);
    advance(index + 1);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-950/85 backdrop-blur-sm flex items-end"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-xl mx-auto rounded-t-3xl bg-ink-950 border-t border-ink-700 max-h-[92vh] flex flex-col overflow-hidden"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {total > 0 && !done && (
          <div className="h-1 bg-ink-800 shrink-0" aria-hidden>
            <div
              className="h-full bg-amber-glow transition-[width] duration-200"
              style={{ width: `${(index / total) * 100}%` }}
            />
          </div>
        )}

        <header className="px-5 pt-4 pb-3 border-b border-ink-800/70 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Duplicate finder
            </div>
            <h2 className="mt-0.5 text-lg font-bold text-ink-100 leading-tight tabular-nums">
              {total === 0
                ? 'No duplicates'
                : done
                  ? 'All reviewed'
                  : `Group ${index + 1} of ${total}`}
            </h2>
            {total > 0 && !done && (merged > 0 || skipped > 0) && (
              <div className="mt-1 text-[11px] text-ink-500 tabular-nums">
                <span className="text-ink-300 font-semibold">{merged}</span>{' '}
                merged{' · '}
                <span className="text-ink-300 font-semibold">{skipped}</span>{' '}
                skipped
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="w-11 h-11 -mr-2 shrink-0 rounded-full flex items-center justify-center text-ink-300 active:bg-ink-800 disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              width={22}
              height={22}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {total === 0 && (
            <div className="py-14 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
                <CheckCircleIcon className="w-8 h-8" />
              </div>
              <p className="mt-4 text-ink-100 text-base font-bold">
                No duplicates found
              </p>
              <p className="mt-1.5 max-w-[17rem] text-ink-500 text-xs leading-relaxed">
                Every candidate in the pool has a distinct title and IMDb id.
              </p>
            </div>
          )}

          {done && total > 0 && (
            <div className="py-14 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-amber-glow/10 border border-amber-glow/30 flex items-center justify-center text-amber-glow">
                <CheckCircleIcon className="w-8 h-8" />
              </div>
              <p className="mt-4 text-ink-100 text-lg font-bold">All done</p>
              <p className="mt-1 text-sm text-ink-400">
                Reviewed all {total} {total === 1 ? 'group' : 'groups'}.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span className="inline-flex items-baseline gap-1.5 rounded-full bg-amber-glow/10 border border-amber-glow/30 px-3 py-1 text-xs font-semibold text-amber-glow tabular-nums">
                  <span className="text-sm font-bold">{merged}</span> merged
                </span>
                <span className="inline-flex items-baseline gap-1.5 rounded-full bg-ink-800 border border-ink-700 px-3 py-1 text-xs font-semibold text-ink-300 tabular-nums">
                  <span className="text-sm font-bold text-ink-200">
                    {skipped}
                  </span>{' '}
                  skipped
                </span>
              </div>
            </div>
          )}

          {group && keeper && (
            <>
              <div
                className={`mb-4 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-xs leading-relaxed ${
                  group.sharesImdbId
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-glow/10 border border-amber-glow/30 text-amber-glow'
                }`}
              >
                <span aria-hidden className="mt-px shrink-0">
                  {group.sharesImdbId ? (
                    <CheckCircleIcon className="w-4 h-4" />
                  ) : (
                    <AlertTriangleIcon className="w-4 h-4" />
                  )}
                </span>
                <span>
                  <span className="font-bold">
                    {group.confirmedIdentity ? 'Confirmed IMDb identity' : 'Possible title or identity match'}
                  </span>
                  {group.confirmedIdentity
                    ? ' — same IMDb record and compatible years.'
                    : ' — check IMDb links, years, and sequel subtitles before merging. Conflicting records remain separate until reviewed.'}
                </span>
              </div>

              {!!group.aliasEvidence?.length && <div className="mb-4 space-y-2 rounded-xl border border-amber-glow/30 p-3 text-xs text-ink-300">
                <p className="font-semibold text-amber-glow">Possible intended title — review required</p>
                {group.aliasEvidence.map(evidence => <div key={evidence.sourceUrl}><p>{evidence.explanation}</p><a className="inline-flex min-h-[44px] items-center text-amber-glow underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.sourceLabel}</a></div>)}
                <p>Missing links or posters alone do not establish a duplicate. Keep records separate if the identities differ.</p>
              </div>}

              {group.members.length > 2 && (
                <p className="mb-3 text-[11px] text-ink-500 leading-relaxed">
                  Tap a record to keep it. Toggle the others to choose which
                  fold in — any left separate stay as their own pool entry.
                </p>
              )}

              <div className="relative">
                <div
                  className="grid gap-3 grid-cols-1"
                >
                  {group.members.map((c, i) => {
                    const isKeeper = i === keeperIdx && !excluded.has(i);
                    return (
                      <DupeCard
                        key={i}
                        c={c}
                        selected={isKeeper}
                        included={!excluded.has(i)}
                        inLibrary={isInLibrary(c)}
                        onSelect={() => selectKeeper(i)}
                        onToggleInclude={
                          () => toggleExclude(i)
                        }
                      />
                    );
                  })}
                </div>

              </div>

              {idConflicts.length > 0 && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-crimson-deep/15 border border-crimson-deep/50 px-3.5 py-3 text-xs leading-relaxed text-crimson-bright">
                  <AlertTriangleIcon className="w-4 h-4 mt-px shrink-0" />
                  <p>
                    <span className="font-bold">Different IMDb IDs.</span> The
                    record{idConflicts.length === 1 ? '' : 's'} you&rsquo;re
                    folding in {idConflicts.length === 1 ? 'has' : 'have'} a
                    different IMDb id than the one you&rsquo;re keeping — IMDb
                    ids are unique per title, so these are probably{' '}
                    <span className="font-bold">different movies</span> (e.g. a
                    sequel).{' '}
                    {conflictInLibrary
                      ? 'They are separately tracked in your list. '
                      : ''}
                    Skip unless they&rsquo;re genuinely the same film.
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-ink-900 border border-ink-800 px-3.5 py-3 text-xs leading-relaxed text-ink-400">
                <CheckCircleIcon className="w-4 h-4 mt-px shrink-0 text-emerald-300" />
                <p>
                  {libraryVictims.length > 0 ? (
                    <>
                      <span className="font-semibold text-ink-300">
                        {libraryVictims.length}
                      </span>{' '}
                      of these{' '}
                      {libraryVictims.length === 1 ? 'is' : 'are'} in a list —
                      merging keeps{' '}
                      {libraryVictims.length === 1 ? 'it' : 'them'} linked.{' '}
                    </>
                  ) : null}
                  Folded-in copies move to{' '}
                  <span className="font-semibold text-ink-300">Removed</span> and
                  can be restored — nothing is deleted.
                </p>
              </div>

              {error && (
                <p className="mt-4 text-center text-xs text-crimson-bright">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-5 pt-3 border-t border-ink-800/70 shrink-0">
          {group ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={handleSkip}
                className="min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700 disabled:opacity-50"
              >
                Keep separate
              </button>
              <button
                type="button"
                disabled={busy || !keeper || victims.length === 0}
                onClick={() => void handleMerge()}
                className={`min-h-[48px] rounded-2xl text-sm font-bold active:opacity-80 disabled:opacity-50 flex items-center justify-center gap-2 ${
                  idConflicts.length > 0
                    ? 'bg-ink-800 border border-crimson-deep/60 text-crimson-bright'
                    : 'bg-amber-glow text-ink-950'
                }`}
              >
                {busy ? (
                  <>
                    <span
                      aria-hidden
                      className="inline-block w-3 h-3 rounded-full border-2 border-ink-950 border-t-transparent animate-spin"
                    />
                    Merging…
                  </>
                ) : victims.length === 0 ? (
                  <>Select to merge</>
                ) : (
                  <>Merge {victims.length} in</>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[48px] rounded-2xl bg-amber-glow text-ink-950 text-sm font-bold active:opacity-80"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// One candidate card inside the review stepper. Tap the body to choose it as
// the survivor (amber ring + "Keep" badge). For groups of 3+, non-keeper cards
// also get a toggle to include/exclude them from the merge — an excluded card
// dims and reads "Separate", and stays as its own pool row.
function DupeCard({
  c,
  selected,
  included = true,
  inLibrary,
  onSelect,
  onToggleInclude,
}: {
  c: Candidate;
  selected: boolean;
  included?: boolean;
  inLibrary: boolean;
  onSelect: () => void;
  onToggleInclude?: () => void;
}) {
  const separate = onToggleInclude != null && !included;
  const badge = selected ? 'Keep' : separate ? 'Separate' : 'Merge in';

  return (
    <div
      className={`relative flex flex-col rounded-2xl border transition-colors ${
        selected
          ? 'bg-amber-glow/5 border-amber-glow ring-1 ring-amber-glow'
          : separate
            ? 'bg-ink-900 border-ink-800 opacity-55'
            : 'bg-ink-900 border-ink-700'
      }`}
    >
      <div
        className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
          selected
            ? 'bg-amber-glow text-ink-950'
            : separate
              ? 'bg-ink-800 text-ink-500'
              : 'bg-ink-800 text-ink-300'
        }`}
      >
        {selected && <CheckIcon className="w-2.5 h-2.5" />}
        {badge}
      </div>

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="text-left p-3 rounded-2xl active:bg-ink-800/30 transition-colors"
      >
        <div className="flex gap-3">
          {c.poster ? (
            <img
              src={c.poster}
              alt=""
              className="w-[46px] h-[69px] rounded-md object-cover border border-ink-700 shrink-0 bg-ink-800"
              loading="lazy"
            />
          ) : (
            <div className="w-[46px] h-[69px] rounded-md bg-ink-800 border border-ink-700 shrink-0 flex items-center justify-center">
              <span className="text-base font-bold text-ink-600 select-none">
                {(c.displayTitle ?? c.title).charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink-100 leading-snug pt-6 break-words">
              {c.displayTitle ?? c.title}
            </div>
        {c.displayTitle && c.displayTitle !== c.title && <p className="mt-1 break-words text-xs leading-relaxed text-ink-400">Catalog title: {c.title}</p>}
            <div className="mt-0.5 text-[11px] font-mono tabular-nums text-ink-500">
              {c.year ?? '—'}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              c.imdbId
                ? 'border-emerald-500/40 text-emerald-300'
                : 'border-ink-700 text-ink-500'
            }`}
          >
            {c.imdbId ? 'Linked' : 'Unlinked'}
          </span>
          {inLibrary && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-crimson-deep/60 text-crimson-bright">
              In library
            </span>
          )}
          {c.commonSenseAge && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${ageBadgeClass(
                c.commonSenseAge,
              )}`}
            >
              {c.commonSenseAge}
            </span>
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-x-2 text-[11px]">
          <DupeStat label="RT" value={c.rottenTomatoes} />
          <DupeStat label="IMDb" value={c.imdb} />
        </div>

        <div className="mt-2 text-[10.5px] font-medium truncate">
          {c.studio ? (
            <span className="text-ink-500">{c.studio}</span>
          ) : (
            <span className="text-ink-600">No studio</span>
          )}
        </div>
        <div className="mt-1 text-[10px] text-ink-600 tabular-nums">
          added {formatRelativeTime(c.addedAt)}
        </div>
      </button>

      {onToggleInclude && (
        <button
          type="button"
          onClick={onToggleInclude}
          aria-pressed={included}
          className={`mx-3 mb-3 min-h-[44px] rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            included
              ? 'bg-amber-glow/10 border-amber-glow/40 text-amber-glow active:bg-amber-glow/20'
              : 'bg-ink-800 border-ink-700 text-ink-400 active:bg-ink-700'
          }`}
        >
          {included ? (
            <>
              <CheckIcon className="w-3 h-3" />
              Included in merge
            </>
          ) : (
            <>Keep separate</>
          )}
        </button>
      )}
    </div>
  );
}

// One aligned RT / IMDb metric slot inside a DupeCard. Always renders so the
// two cards' rows line up even when one is missing a score.
function DupeStat({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[8px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </span>
      <span
        className={`font-semibold tabular-nums ${
          value ? 'text-ink-300' : 'text-ink-600'
        }`}
      >
        {value ?? '—'}
      </span>
    </span>
  );
}

function ExpansionSummary({ report }: { report: ExpansionReport }) {
  const reasons: Record<string, string> = {
    deadline: 'Discovery reached its 30-second time limit. Titles returned before the cutoff were checked.',
    network: 'The discovery service connection failed before it finished.',
    rate_limit: 'The discovery provider rate limit was reached. Try again later.',
    service_auth: 'The discovery provider rejected the service credentials. An administrator needs to check configuration.',
    provider_error: 'The discovery provider returned a service error before finishing.',
    model_output_limit: 'Discovery reached its response-size limit before finishing the candidate list.',
    search_continuation_limit: 'Discovery reached its bounded search continuation limit.',
    invalid_output: 'Discovery returned an incomplete or invalid candidate list. Recoverable titles were checked.',
    model_refusal: 'The discovery model declined this request.',
    model_stopped: 'The discovery model stopped before completing its answer.',
    service_error: 'The discovery service failed before returning results.',
    legacy_completion_unknown: 'Original method does not report whether discovery completed; comparison is provisional.',
  };
  const reason = report.api.completionObserved === false ? reasons.legacy_completion_unknown : reasons[report.api.reason ?? ''];
  return <div className="text-sm text-ink-300 space-y-1">
    <p>{report.api.rawGenerated ?? report.raw} generated · {report.raw} returned · {report.checked} checked · {report.verified} verified</p>
    <p className="text-xs text-ink-400">{report.duplicates} duplicates skipped · {report.unmatched} unmatched · {report.errors} lookup errors</p>
    {report.status === 'partial' && <p className="text-amber-glow">{reason ?? (report.errors ? 'Some movie database checks failed; their categories are shown below.' : 'Discovery did not report a completion reason for this run.')}</p>}
    {!!report.lookupErrors?.network && <p className="text-xs text-amber-glow">{report.lookupErrors.network} movie database connection errors.</p>}
    {!!report.lookupErrors?.notConfigured && <p className="text-xs text-amber-glow">{report.lookupErrors.notConfigured} movie database checks could not run because the service is not configured.</p>}
    {!!report.lookupErrors?.notFound && <p className="text-xs text-ink-400">{report.lookupErrors.notFound} movie database records were not found.</p>}
    {!!report.lookupErrors?.unknown && <p className="text-xs text-amber-glow">{report.lookupErrors.unknown} movie database errors had no recognized category.</p>}
    {report.api.runId && <p className="text-xs text-ink-500 break-all">Run reference: {report.api.runId}</p>}
    <details><summary className="min-h-[44px] flex items-center cursor-pointer text-amber-glow">See verified candidates</summary>
      <ul className="space-y-1 break-words">{report.candidates.map(c => <li key={c.imdbId ?? `${c.title}:${c.year}`}>{c.title} ({c.year ?? 'Year unknown'})</li>)}</ul>
    </details>
    {!!report.api.sourceUrls?.length && <details><summary className="min-h-[44px] flex items-center cursor-pointer">Discovery sources</summary><ul>{report.api.sourceUrls.filter(url => /^https?:\/\//i.test(url)).map(url => <li key={url} className="break-all"><a href={url} target="_blank" rel="noreferrer" className="text-amber-glow">{url}</a></li>)}</ul></details>}
  </div>;
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ThumbsDownIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11l-3.17 6.34A1.94 1.94 0 0 1 10.55 22 2.55 2.55 0 0 1 8 19.46a2.84 2.84 0 0 1 .1-.82Z" />
    </svg>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-ink-600 uppercase tracking-wider font-semibold">
        {label}
      </span>
      <span className="flex-1 text-ink-400 truncate">{value ?? '—'}</span>
    </div>
  );
}

type BulkOmdbPhase = 'idle' | 'confirm' | 'running' | 'done' | 'cancelled';

function PosterRepairSection({pool,onEdit}:{pool:CandidatePoolApi;onEdit:(candidate:Candidate)=>void}) {
  const [busy,setBusy] = useState(false);
  const [progress,setProgress] = useState({done:0,total:0});
  const [result,setResult] = useState<(PosterRepairReport & {repaired:number;skipped:number}) | null>(null);
  const [error,setError] = useState<string | null>(null);
  const cancellation = useRef({cancelled:false});
  useEffect(() => () => { cancellation.current.cancelled = true; },[]);
  async function run() {
    if (busy) return;
    setBusy(true);setError(null);setResult(null);cancellation.current = {cancelled:false};
    try {
      const report = await scanPosterRepairs(pool.candidates,(done,total)=>setProgress({done,total}),cancellation.current);
      let repaired = 0, skipped = 0;
      if (report.patches.length) await pool.replaceCandidates(current => {
        const applied = applyPosterRepairs(current,report.patches);
        repaired = applied.repaired; skipped = applied.skipped;
        return applied.candidates;
      });
      setResult({...report,repaired,skipped});
    } catch { setError('Repairs could not be saved. No successful repair count is reported; reload and try again.'); }
    finally {setBusy(false);}
  }
  return <section className="px-4 py-2 space-y-2">
    <button type="button" disabled={busy || !['synced','empty'].includes(pool.status)} onClick={()=>void run()} className="w-full min-h-[48px] rounded-xl border border-ink-700 bg-ink-800 text-sm font-semibold text-ink-200 disabled:opacity-50">{busy ? `Checking posters and links… ${progress.done}/${progress.total}` : 'Check and repair posters & links'}</button>
    {busy && <button type="button" onClick={()=>{cancellation.current.cancelled=true;}} className="min-h-[44px] text-sm text-ink-300">Stop after this movie</button>}
    {error && <p role="alert" className="text-sm text-crimson-bright">{error}</p>}
    {result && <div role="status" className="text-xs text-ink-300 space-y-2">
      <p>{result.repaired} repaired · {result.unchanged} unchanged · {result.unresolved} unresolved · {result.failed} checks failed · {result.review.length} need review{result.skipped ? ` · ${result.skipped} changed during scan; skipped` : ''}{result.cancelled ? ' · stopped early' : ''}</p>
      <p>Only exact title, year, and film matches are repaired. Family lists stay unchanged. Unavailable posters may be temporary; failing URLs are not deleted.</p>
      {!!result.review.length && <details><summary className="min-h-[44px] flex items-center text-amber-glow cursor-pointer">Review uncertain links</summary><ul>{result.review.map((issue,index)=><li key={index} className="border-t border-ink-800 py-2"><p>{issue.reason}</p><button type="button" onClick={()=>onEdit(issue.candidate)} className="min-h-[44px] text-amber-glow">Review {issue.candidate.displayTitle ?? issue.candidate.title}</button></li>)}</ul></details>}
    </div>}
  </section>;
}

function BulkOmdbSection({ pool }: { pool: CandidatePoolApi }) {
  const [phase, setPhase] = useState<BulkOmdbPhase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    updated: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const linkedCount = pool.candidates.filter((c) => c.imdbId != null).length;

  async function run() {
    cancelRef.current = { cancelled: false };
    setPhase('running');
    setProgress({ done: 0, total: linkedCount });
    const r = await pool.bulkRefreshOmdb(
      (done, total) => setProgress({ done, total }),
      cancelRef.current,
    );
    setResult(r);
    setPhase(cancelRef.current.cancelled ? 'cancelled' : 'done');
  }

  if (phase === 'idle') {
    if (linkedCount === 0) return null;
    return (
      <div className="px-4 pt-4 pb-2">
        <button
          type="button"
          onClick={() => setPhase('confirm')}
          className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700"
        >
          Update movie details
          <span className="ml-1.5 text-ink-500 font-normal">
            ({linkedCount} linked)
          </span>
        </button>
      </div>
    );
  }

  if (phase === 'confirm') {
    return (
      <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
        <h3 className="text-base font-bold text-ink-100">Update movie details</h3>
        <p className="mt-1 text-sm text-ink-400 leading-relaxed">
          Re-fetches director, writer, ratings, poster, and awards from OMDB for
          all {linkedCount} linked candidates. Updates propagate to watched and
          wishlist movies automatically.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPhase('idle')}
            className="min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run()}
            className="min-h-[44px] rounded-2xl bg-amber-glow text-ink-950 text-sm font-bold active:opacity-80"
          >
            Refresh {linkedCount}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    const pct =
      progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
    return (
      <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
        <h3 className="text-base font-bold text-ink-100">
          Refreshing OMDB…
        </h3>
        <div className="mt-2 text-sm text-ink-300">
          <span className="font-semibold tabular-nums">{progress.done}</span>
          {' '}of{' '}
          <span className="tabular-nums">{progress.total}</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-ink-800 overflow-hidden">
          <div
            className="h-full bg-amber-glow transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            cancelRef.current.cancelled = true;
          }}
          className="mt-4 w-full min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
      <h3 className="text-base font-bold text-ink-100">
        {phase === 'cancelled' ? 'Cancelled' : 'Done'}
      </h3>
      {result && (
        <p className="mt-1 text-sm text-ink-400 leading-relaxed">
          <span className="text-ink-200 font-semibold">{result.updated}</span>{' '}
          updated ·{' '}
          <span className="text-ink-300">{result.skipped}</span> skipped ·{' '}
          <span className="text-ink-300">{result.failed}</span> failed
        </p>
      )}
      <button
        type="button"
        onClick={() => setPhase('idle')}
        className="mt-4 w-full min-h-[44px] rounded-2xl bg-amber-glow text-ink-950 text-sm font-bold active:opacity-80"
      >
        Done
      </button>
    </div>
  );
}

type BulkStreamingPhase = 'idle' | 'confirm' | 'running' | 'done' | 'cancelled';

// Bulk "Where to watch" refresh, mirroring BulkOmdbSection. Resolves Watchmode
// availability for every linked candidate in one sweep so the admin can
// backfill all movies at once instead of opening each Detail screen. Hides
// itself entirely when no Watchmode key is configured.
function BulkStreamingSection({ pool }: { pool: CandidatePoolApi }) {
  const [phase, setPhase] = useState<BulkStreamingPhase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    updated: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const linkedCount = pool.candidates.filter((c) => c.imdbId != null).length;

  if (!isStreamingConfigured) return null;

  async function run() {
    cancelRef.current = { cancelled: false };
    setPhase('running');
    setProgress({ done: 0, total: linkedCount });
    const r = await pool.bulkRefreshStreaming(
      (done, total) => setProgress({ done, total }),
      cancelRef.current,
    );
    setResult(r);
    setPhase(cancelRef.current.cancelled ? 'cancelled' : 'done');
  }

  if (phase === 'idle') {
    if (linkedCount === 0) return null;
    return (
      <div className="px-4 pt-1 pb-2">
        <button
          type="button"
          onClick={() => setPhase('confirm')}
          className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700"
        >
          Update where to watch
          <span className="ml-1.5 text-ink-500 font-normal">
            ({linkedCount} linked)
          </span>
        </button>
      </div>
    );
  }

  if (phase === 'confirm') {
    return (
      <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
        <h3 className="text-base font-bold text-ink-100">
          Bulk refresh streaming
        </h3>
        <p className="mt-1 text-sm text-ink-400 leading-relaxed">
          Re-fetches US &ldquo;where to watch&rdquo; data from Watchmode for all{' '}
          {linkedCount} linked candidates. Updates propagate to watched and
          wishlist movies automatically.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPhase('idle')}
            className="min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run()}
            className="min-h-[44px] rounded-2xl bg-amber-glow text-ink-950 text-sm font-bold active:opacity-80"
          >
            Refresh {linkedCount}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    const pct =
      progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
    return (
      <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
        <h3 className="text-base font-bold text-ink-100">
          Refreshing streaming…
        </h3>
        <div className="mt-2 text-sm text-ink-300">
          <span className="font-semibold tabular-nums">{progress.done}</span>
          {' '}of{' '}
          <span className="tabular-nums">{progress.total}</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-ink-800 overflow-hidden">
          <div
            className="h-full bg-amber-glow transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            cancelRef.current.cancelled = true;
          }}
          className="mt-4 w-full min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
      <h3 className="text-base font-bold text-ink-100">
        {phase === 'cancelled' ? 'Cancelled' : 'Done'}
      </h3>
      {result && (
        <p className="mt-1 text-sm text-ink-400 leading-relaxed">
          <span className="text-ink-200 font-semibold">{result.updated}</span>{' '}
          with providers ·{' '}
          <span className="text-ink-300">{result.skipped}</span> none ·{' '}
          <span className="text-ink-300">{result.failed}</span> failed
        </p>
      )}
      <button
        type="button"
        onClick={() => setPhase('idle')}
        className="mt-4 w-full min-h-[44px] rounded-2xl bg-amber-glow text-ink-950 text-sm font-bold active:opacity-80"
      >
        Done
      </button>
    </div>
  );
}

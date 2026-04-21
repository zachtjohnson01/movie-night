import { useMemo, useRef, useState } from 'react';
import type { Movie } from '../types';
import { getDisplayTitle } from '../format';
import { enrichMovies } from '../enrich';

type Props = {
  /** Movies on the active tab — pre-filtered by Watched/Wishlist by the caller. */
  movies: Movie[];
  scope: 'watched' | 'wishlist';
  onUpdateMovie: (originalTitle: string, updated: Movie) => Promise<void>;
  onClose: () => void;
};

type Phase = 'confirm' | 'running' | 'done' | 'cancelled';

type Results = {
  enriched: string[]; // titles where at least one of production/awards was filled in
  skipped: string[]; // Claude returned both fields blank
  failed: Array<{ title: string; error: string }>;
};

const INITIAL_RESULTS: Results = { enriched: [], skipped: [], failed: [] };

// Server caps a single Claude call at 100 movies. Chunk the input so very
// large libraries still complete in multiple batches.
const BATCH_SIZE = 50;

/**
 * Modal sheet that asks Claude to fill in `production` (studio) and `awards`
 * for every movie on the current tab that's missing one or both. Existing
 * non-null values are preserved — Claude only ever fills nulls. Other fields
 * (notes, dates, ratings, posters) are never touched.
 */
export default function EnhanceAllSheet({
  movies,
  scope,
  onUpdateMovie,
  onClose,
}: Props) {
  // Snapshot of needs-enriching movies at mount. We don't re-derive from
  // `movies` during the run because `movies` updates on every write and
  // we'd end up iterating a moving target.
  const targets = useMemo(
    () => movies.filter((m) => m.production == null || m.awards == null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [phase, setPhase] = useState<Phase>('confirm');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Results>(INITIAL_RESULTS);
  const cancelRef = useRef(false);

  async function run() {
    setPhase('running');
    setProgress(0);
    cancelRef.current = false;
    const acc: Results = { enriched: [], skipped: [], failed: [] };

    for (let start = 0; start < targets.length; start += BATCH_SIZE) {
      if (cancelRef.current) {
        setResults(acc);
        setPhase('cancelled');
        return;
      }
      const batch = targets.slice(start, start + BATCH_SIZE);
      let items;
      try {
        items = await enrichMovies(
          batch.map((m) => ({
            title: m.title,
            year: m.year,
            imdbId: m.imdbId,
          })),
        );
      } catch (e) {
        // Whole-batch failure — mark every movie in this batch as failed.
        const msg = (e as Error).message || 'unknown error';
        for (const m of batch) {
          acc.failed.push({ title: getDisplayTitle(m), error: msg });
        }
        setProgress(Math.min(start + batch.length, targets.length));
        continue;
      }

      // Match by index, since Claude sometimes reformats titles slightly.
      for (let i = 0; i < batch.length; i++) {
        if (cancelRef.current) {
          setResults(acc);
          setPhase('cancelled');
          return;
        }
        const m = batch[i];
        const item = items[i];
        if (!item) {
          acc.skipped.push(getDisplayTitle(m));
          setProgress(start + i + 1);
          continue;
        }
        // Fill nulls only — never overwrite existing studio/awards.
        const nextProduction = m.production ?? item.production;
        const nextAwards = m.awards ?? item.awards;
        const changed =
          nextProduction !== m.production || nextAwards !== m.awards;
        if (!changed) {
          acc.skipped.push(getDisplayTitle(m));
          setProgress(start + i + 1);
          continue;
        }
        try {
          await onUpdateMovie(m.title, {
            ...m,
            production: nextProduction,
            awards: nextAwards,
          });
          acc.enriched.push(getDisplayTitle(m));
        } catch (e) {
          acc.failed.push({
            title: getDisplayTitle(m),
            error: (e as Error).message || 'write failed',
          });
        }
        setProgress(start + i + 1);
      }
    }

    setResults(acc);
    setPhase('done');
  }

  function cancel() {
    cancelRef.current = true;
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={phase === 'running' ? undefined : onClose}
    >
      <div
        className="w-full max-w-xl bg-ink-900 border-t border-ink-800 rounded-t-3xl shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2">
          <div className="w-10 h-1.5 rounded-full bg-ink-700" />
        </div>

        <div className="px-5 pt-4 pb-5">
          {phase === 'confirm' && (
            <ConfirmView
              count={targets.length}
              scope={scope}
              onRun={run}
              onClose={onClose}
            />
          )}
          {phase === 'running' && (
            <RunningView
              count={targets.length}
              progress={progress}
              current={
                progress < targets.length
                  ? getDisplayTitle(targets[progress])
                  : ''
              }
              onCancel={cancel}
            />
          )}
          {(phase === 'done' || phase === 'cancelled') && (
            <SummaryView
              phase={phase}
              results={results}
              total={targets.length}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmView({
  count,
  scope,
  onRun,
  onClose,
}: {
  count: number;
  scope: 'watched' | 'wishlist';
  onRun: () => void;
  onClose: () => void;
}) {
  if (count === 0) {
    return (
      <>
        <h2 className="text-xl font-bold">Nothing to enhance</h2>
        <p className="mt-1 text-sm text-ink-400 leading-relaxed">
          Every movie on the {scope === 'watched' ? 'Watched' : 'Wishlist'}{' '}
          tab already has studio and awards data.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full min-h-[52px] rounded-2xl bg-ink-800 border border-ink-700 font-semibold active:bg-ink-700"
        >
          Close
        </button>
      </>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold">
        Enhance {count} {count === 1 ? 'movie' : 'movies'}
      </h2>
      <p className="mt-2 text-sm text-ink-400 leading-relaxed">
        We&apos;ll ask Claude to fill in the lead studio and a brief awards
        summary for every movie on the{' '}
        {scope === 'watched' ? 'Watched' : 'Wishlist'} tab that&apos;s missing
        one or both. Existing values are preserved.
      </p>
      <p className="mt-3 text-xs text-ink-500 leading-relaxed">
        Notes, dates, ratings, and posters aren&apos;t touched. Claude can be
        wrong on obscure titles — spot-check after.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[52px] rounded-2xl bg-ink-800 border border-ink-700 font-semibold active:bg-ink-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onRun}
          className="min-h-[52px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80"
        >
          Enhance {count}
        </button>
      </div>
    </>
  );
}

function RunningView({
  count,
  progress,
  current,
  onCancel,
}: {
  count: number;
  progress: number;
  current: string;
  onCancel: () => void;
}) {
  const pct = count === 0 ? 0 : (progress / count) * 100;
  return (
    <>
      <h2 className="text-xl font-bold">Enhancing movies…</h2>
      <div className="mt-3 text-sm text-ink-300">
        <span className="tabular-nums font-semibold text-ink-100">
          {progress}
        </span>{' '}
        of <span className="tabular-nums text-ink-300">{count}</span>
      </div>
      <div className="mt-1 text-xs text-ink-500 truncate">{current}</div>

      <div className="mt-4 h-2 rounded-full bg-ink-800 overflow-hidden">
        <div
          className="h-full bg-amber-glow transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="mt-5 w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 font-semibold active:bg-ink-700"
      >
        Cancel
      </button>
    </>
  );
}

function SummaryView({
  phase,
  results,
  total,
  onClose,
}: {
  phase: 'done' | 'cancelled';
  results: Results;
  total: number;
  onClose: () => void;
}) {
  const { enriched, skipped, failed } = results;
  const title =
    phase === 'cancelled'
      ? 'Cancelled'
      : `Enhanced ${enriched.length} of ${total}`;

  return (
    <>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-ink-400 leading-relaxed">
        {enriched.length > 0 && (
          <>
            {enriched.length} movie{enriched.length === 1 ? '' : 's'} updated.{' '}
          </>
        )}
        {skipped.length > 0 && (
          <>
            {skipped.length} skipped (Claude had no new info).{' '}
          </>
        )}
        {failed.length > 0 && (
          <>
            {failed.length} failed with an error.{' '}
          </>
        )}
      </p>

      {skipped.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs uppercase tracking-[0.18em] text-ink-500 font-semibold cursor-pointer">
            Skipped ({skipped.length})
          </summary>
          <ul className="mt-2 max-h-40 overflow-auto text-sm text-ink-300 space-y-1">
            {skipped.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}

      {failed.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs uppercase tracking-[0.18em] text-ink-500 font-semibold cursor-pointer">
            Errors ({failed.length})
          </summary>
          <ul className="mt-2 max-h-40 overflow-auto text-sm text-rose-300 space-y-1">
            {failed.map((f) => (
              <li key={f.title}>
                <span className="text-ink-200">{f.title}</span>
                <span className="text-ink-500"> — {f.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-5 w-full min-h-[52px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80"
      >
        Done
      </button>
    </>
  );
}

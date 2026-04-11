import { useMemo, useRef, useState } from 'react';
import type { Movie } from '../types';
import { getDisplayTitle } from '../format';
import { linkByTitle, OmdbError } from '../omdb';

type Props = {
  movies: Movie[];
  onUpdateMovie: (originalTitle: string, updated: Movie) => Promise<void>;
  onClose: () => void;
};

type Phase = 'confirm' | 'running' | 'done' | 'cancelled';

type Results = {
  linked: Array<{ originalTitle: string; newTitle: string }>;
  skipped: string[]; // OMDB returned nothing OR top result didn't look close enough
  failed: Array<{ title: string; error: string }>;
};

const INITIAL_RESULTS: Results = { linked: [], skipped: [], failed: [] };

// Small delay between OMDB requests so we're polite to the free tier
// and so React has time to render the progress counter between each.
const DELAY_BETWEEN_MS = 150;

/**
 * Modal overlay that walks through every unlinked movie and links each
 * one to OMDB by searching its title and picking the top result. Shows
 * a live progress counter during the run and a summary of linked /
 * not-found / failed movies at the end.
 *
 * Safe to cancel mid-run via the Cancel button — any movies already
 * linked before the cancel stay linked.
 */
export default function BulkLinkSheet({
  movies,
  onUpdateMovie,
  onClose,
}: Props) {
  // Snapshot of unlinked movies at mount. We don't re-derive from
  // `movies` during the run because `movies` changes on every write
  // and we'd end up iterating a moving target.
  const unlinked = useMemo(
    () =>
      movies.filter(
        (m) => m.imdbId == null && m.title.trim().length >= 3,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [phase, setPhase] = useState<Phase>('confirm');
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Results>(INITIAL_RESULTS);
  const cancelRef = useRef(false);

  async function run() {
    setPhase('running');
    cancelRef.current = false;
    const acc: Results = { linked: [], skipped: [], failed: [] };

    for (let i = 0; i < unlinked.length; i++) {
      if (cancelRef.current) {
        setResults(acc);
        setPhase('cancelled');
        return;
      }
      setIndex(i);
      const m = unlinked[i];
      try {
        const patch = await linkByTitle(m.title);
        if (!patch) {
          // Show the user-facing display title in the skipped list so
          // they can recognize the movie by the name they know.
          acc.skipped.push(getDisplayTitle(m));
        } else {
          // Fill semantics: OMDB data fills in nulls, but title and
          // imdbId always get overwritten with OMDB's canonical
          // values. Never clobber notes / dateWatched / CSM age.
          const updated: Movie = {
            ...m,
            title: patch.title,
            imdbId: patch.imdbId,
            year: m.year ?? patch.year,
            imdb: m.imdb ?? patch.imdb,
            rottenTomatoes: m.rottenTomatoes ?? patch.rottenTomatoes,
            poster: m.poster ?? patch.poster,
            omdbRefreshedAt: new Date().toISOString(),
          };
          await onUpdateMovie(m.title, updated);
          acc.linked.push({
            originalTitle: m.title,
            newTitle: patch.title,
          });
        }
      } catch (e) {
        acc.failed.push({
          title: getDisplayTitle(m),
          error:
            e instanceof OmdbError
              ? e.message
              : (e as Error).message || 'unknown error',
        });
      }
      // Gentle throttle between requests.
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
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
              count={unlinked.length}
              onRun={run}
              onClose={onClose}
            />
          )}
          {phase === 'running' && (
            <RunningView
              count={unlinked.length}
              index={index}
              current={
                unlinked[index] ? getDisplayTitle(unlinked[index]) : ''
              }
              onCancel={cancel}
            />
          )}
          {(phase === 'done' || phase === 'cancelled') && (
            <SummaryView
              phase={phase}
              results={results}
              total={unlinked.length}
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
  onRun,
  onClose,
}: {
  count: number;
  onRun: () => void;
  onClose: () => void;
}) {
  if (count === 0) {
    return (
      <>
        <h2 className="text-xl font-bold">Nothing to link</h2>
        <p className="mt-1 text-sm text-ink-400 leading-relaxed">
          Every movie on the list is already linked to OMDB.
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
      <h2 className="text-xl font-bold">Link {count} movies to OMDB</h2>
      <p className="mt-2 text-sm text-ink-400 leading-relaxed">
        We&apos;ll search each unlinked movie by title and pick OMDB&apos;s
        top match. This populates the poster, year, RT, and IMDb rating
        for each, and rewrites the title to OMDB&apos;s canonical version.
      </p>
      <p className="mt-3 text-xs text-ink-500 leading-relaxed">
        Ambiguous titles like &ldquo;GOAT&rdquo; or &ldquo;Flow&rdquo; may
        match the wrong movie. Spot-check the list afterward and tap
        Delete on any wrong matches. Your notes and watched dates are
        preserved either way.
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
          Link {count}
        </button>
      </div>
    </>
  );
}

function RunningView({
  count,
  index,
  current,
  onCancel,
}: {
  count: number;
  index: number;
  current: string;
  onCancel: () => void;
}) {
  const progress = count === 0 ? 0 : ((index + 1) / count) * 100;
  return (
    <>
      <h2 className="text-xl font-bold">Linking movies…</h2>
      <div className="mt-3 text-sm text-ink-300">
        <span className="tabular-nums font-semibold text-ink-100">
          {index + 1}
        </span>{' '}
        of{' '}
        <span className="tabular-nums text-ink-300">{count}</span>
      </div>
      <div className="mt-1 text-xs text-ink-500 truncate">{current}</div>

      <div className="mt-4 h-2 rounded-full bg-ink-800 overflow-hidden">
        <div
          className="h-full bg-amber-glow transition-[width] duration-150"
          style={{ width: `${progress}%` }}
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
  const { linked, skipped, failed } = results;
  const title =
    phase === 'cancelled'
      ? 'Cancelled'
      : `Linked ${linked.length} of ${total}`;

  return (
    <>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-ink-400 leading-relaxed">
        {linked.length > 0 && (
          <>
            {linked.length} movie{linked.length === 1 ? '' : 's'} linked.{' '}
          </>
        )}
        {skipped.length > 0 && (
          <>
            {skipped.length} skipped (no confident match).{' '}
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
            Skipped ({skipped.length}) — link manually
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

      {linked.length > 0 && (
        <p className="mt-4 text-xs text-ink-500 leading-relaxed">
          Spot-check the Watched list afterward and fix or delete any wrong
          matches. Your notes and watched dates are unchanged.
        </p>
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

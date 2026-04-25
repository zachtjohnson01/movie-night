import { useCallback, useMemo, useRef, useState } from 'react';
import type { Candidate } from '../types';
import { ageBadgeClass } from '../format';
import type { CandidatePoolApi } from '../useCandidatePool';
import { scoreCandidate } from '../scoring';
import {
  commonSenseUrl,
  dedupKey,
  getMovieById,
  imdbUrl,
  OmdbError,
  rottenTomatoesUrl,
  type OmdbSearchResult,
} from '../omdb';
import MoviePoster from './MoviePoster';
import MovieSearchCombobox from './MovieSearchCombobox';
import StatLink from './StatLink';
import CreatorPills from './CreatorPills';
import WeightsEditor from './WeightsEditor';

type Props = {
  pool: CandidatePoolApi;
  onBack: () => void;
  isOwner: boolean;
};

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
export default function PoolAdmin({ pool, onBack, isOwner }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [active, setActive] = useState<Set<FilterKey>>(new Set());

  // Set of dedup keys that appear at least twice — used both for the
  // "Duplicates" filter chip and for the Eligible complement.
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of pool.candidates) {
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
      const removed = c.removedAt != null;
      const hasSignal = c.rottenTomatoes != null || c.imdb != null;
      const eligible =
        !missingLink && !duplicate && !tvShow && !removed && hasSignal;
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
      fit: scoreCandidate(c),
    }));
    scored.sort((a, b) => b.fit - a.fit || a.i - b.i);
    return scored;
  }, [pool.candidates]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const anyFilter = active.size > 0;
    return ranked.filter(({ c }) => {
      if (q && !c.title.toLowerCase().includes(q)) return false;
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
    <div className="mx-auto max-w-xl pb-8">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
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
              Candidate pool
            </h1>
            <div className="mt-1 text-[11px] text-ink-500 tabular-nums">
              <span className="text-ink-300 font-semibold">
                {pool.candidates.length}
              </span>{' '}
              total ·{' '}
              <span className="text-ink-300 font-semibold">
                {counts.eligible}
              </span>{' '}
              eligible
              {counts.removed > 0 && (
                <>
                  {' · '}
                  <span className="text-ink-300 font-semibold">
                    {counts.removed}
                  </span>{' '}
                  removed
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 relative">
          <input
            type="search"
            inputMode="search"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Search candidates…"
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

        <div className="mt-3 -mx-5 px-5 flex gap-2 overflow-x-auto">
          {FILTER_ORDER.map((key) => {
            const isActive = active.has(key);
            const n = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFilter(key)}
                aria-pressed={isActive}
                className={`shrink-0 h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
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
      </header>

      {isOwner && (
        <WeightsEditor weights={pool.weights} onSave={pool.updateWeights} />
      )}

      <BulkOmdbSection pool={pool} />

      <ul className="pt-2">
        {visible.map(({ c, fit }, i) => (
          <PoolRow
            key={c.title}
            c={c}
            fit={fit}
            rank={i + 1}
            onEdit={() => setEditing(c)}
            onToggleDownvote={() => void pool.toggleDownvote(c.title)}
          />
        ))}
      </ul>

      {visible.length === 0 && (
        <div className="px-6 pt-10 text-center text-ink-400 text-sm">
          {query || active.size > 0
            ? 'No candidates match the current filters.'
            : 'Pool is empty.'}
        </div>
      )}

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
  const removed = c.removedAt != null;
  return (
    <li className="border-b border-ink-800/70">
      <div
        className={`flex gap-3 px-4 py-3.5 ${
          downvoted || removed ? 'opacity-60' : ''
        }`}
      >
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 flex gap-3 text-left active:bg-ink-900 -mx-1 -my-1 px-1 py-1 rounded-lg transition-colors min-w-0"
        >
          <div className="w-8 shrink-0 flex flex-col items-center pt-1 gap-0.5">
            <div
              className="font-display italic leading-none tracking-tight text-ink-300"
              style={{
                fontSize: rank <= 9 ? 24 : 20,
                fontWeight: 400,
                letterSpacing: -1,
              }}
            >
              {rank}
            </div>
            <div className="text-[9px] font-mono text-ink-500 tabular-nums tracking-wider">
              {fit}
            </div>
          </div>

          {c.poster ? (
            <img
              src={c.poster}
              alt=""
              className="w-[52px] h-[78px] rounded-md object-cover border border-ink-700 shrink-0 bg-ink-800"
              loading="lazy"
            />
          ) : (
            <div className="w-[52px] h-[78px] rounded-md bg-ink-800 border border-ink-700 shrink-0 flex items-center justify-center">
              <span className="text-lg font-bold text-ink-600 select-none">
                {c.title.charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <div
                className={`text-[15px] font-semibold leading-tight truncate ${
                  removed ? 'text-ink-300 line-through' : 'text-ink-100'
                }`}
              >
                {c.title}
              </div>
              {c.year && (
                <div className="text-[11px] font-mono text-ink-500 shrink-0 tabular-nums">
                  {c.year}
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              {c.commonSenseAge && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ageBadgeClass(
                    c.commonSenseAge,
                  )}`}
                >
                  {c.commonSenseAge}
                </span>
              )}
              {c.rottenTomatoes && (
                <span className="inline-flex items-baseline gap-1 text-[11px]">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">
                    RT
                  </span>
                  <span className="text-ink-300 font-semibold tabular-nums">
                    {c.rottenTomatoes}
                  </span>
                </span>
              )}
              {c.imdb && (
                <span className="inline-flex items-baseline gap-1 text-[11px]">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">
                    IMDb
                  </span>
                  <span className="text-ink-300 font-semibold tabular-nums">
                    {c.imdb}
                  </span>
                </span>
              )}
              {removed && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-crimson-deep/60 text-crimson-bright uppercase tracking-wider">
                  Removed
                  {c.removedReason ? `: ${c.removedReason}` : ''}
                </span>
              )}
              {downvoted && !removed && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-crimson-deep/60 text-crimson-bright uppercase tracking-wider">
                  Downvoted
                </span>
              )}
            </div>

            {c.studio && (
              <div className="text-[10.5px] text-ink-500 font-medium truncate">
                {c.studio}
              </div>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={onToggleDownvote}
          aria-label={downvoted ? 'Remove downvote' : 'Downvote'}
          aria-pressed={downvoted}
          className={`shrink-0 self-start w-11 h-11 rounded-full flex items-center justify-center border transition-colors ${
            downvoted
              ? 'bg-crimson-deep/20 border-crimson-deep text-crimson-bright'
              : 'bg-ink-800 border-ink-700 text-ink-400 active:bg-ink-700'
          }`}
        >
          <ThumbsDownIcon filled={downvoted} />
        </button>
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
  const [yearStr, setYearStr] = useState(
    candidate.year != null ? String(candidate.year) : '',
  );
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

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const parsedYear = yearStr.trim() ? parseInt(yearStr, 10) : NaN;
    const trimmedId = imdbIdInput.trim();
    const trimmedRtId = rtIdInput.trim();
    await onSave({
      ...candidate,
      title: title.trim() || candidate.title,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      commonSenseAge: age.trim() || null,
      studio: studio.trim() || null,
      imdbId: trimmedId ? trimmedId : null,
      rottenTomatoesId: trimmedRtId ? trimmedRtId : null,
      rottenTomatoes: rt,
      imdb,
      awards,
      poster,
      type,
      directors: directors && directors.length > 0 ? directors : null,
      writers: writers && writers.length > 0 ? writers : null,
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
              displayTitle: null,
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
              displayTitle: null,
            })}
            accent="age"
          />
          <StatLink
            label="RT"
            value={rt}
            href={rottenTomatoesUrl({
              title,
              displayTitle: null,
              rottenTomatoesId: rtIdInput.trim() || null,
            })}
          />
          <StatLink
            label="IMDb"
            value={imdb}
            href={imdbUrl({
              title,
              displayTitle: null,
              imdbId: imdbIdInput.trim() || null,
            })}
          />
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
                className="shrink-0 min-h-[40px] px-4 rounded-xl text-xs font-semibold bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700"
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
                    className={`min-h-[36px] px-3 rounded-full text-xs font-semibold border transition-colors ${
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
          Refresh OMDB metadata
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
        <h3 className="text-base font-bold text-ink-100">Bulk refresh OMDB</h3>
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

import { useCallback, useMemo, useState } from 'react';
import type { Candidate } from '../types';
import { ageBadgeClass } from '../format';
import type { CandidatePoolApi } from '../useCandidatePool';
import { scoreCandidate } from '../scoring';
import { dedupKey, getOmdbTypeById, getOmdbTypeByTitle } from '../omdb';

type Props = {
  pool: CandidatePoolApi;
  onBack: () => void;
};

type PurgeState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; shows: number; duplicates: number };

/**
 * Admin-only screen: browse, edit, and downvote candidates in the pool.
 * Sits on top of the tab-bar navigation (App.tsx screen stack), reachable
 * from the "Manage pool" button on the For You tab. Shows every row in
 * the pool — including unlinked / low-signal entries — so the admin can
 * audit what's actually in row id=2 and spot data quality issues.
 */
export default function PoolAdmin({ pool, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [purge, setPurge] = useState<PurgeState>({ kind: 'idle' });

  const handlePurge = useCallback(async () => {
    const total = pool.candidates.length;
    if (total === 0) {
      setPurge({ kind: 'done', shows: 0, duplicates: 0 });
      return;
    }
    setPurge({ kind: 'running', done: 0, total });

    // Classify every candidate. Fast path: candidates whose `type` was
    // captured at enrichment time (or learned on a previous purge) need
    // no OMDB call. Slow path: look up missing types via OMDB — by
    // imdbId when we have one, by title otherwise. Title lookup catches
    // the LLM hallucinations seeded before the movie-only filter
    // landed, e.g. "Avatar: The Last Airbender" with imdbId:null.
    //
    // Slow-path calls are capped at 6 concurrent. Unbounded Promise.all
    // over 100+ candidates drops a noticeable fraction on mobile radio /
    // free-tier OMDB, and dropped lookups return null ("can't confirm")
    // — which preserves TV shows we meant to remove.
    let done = 0;
    const tick = () => {
      done += 1;
      setPurge({ kind: 'running', done, total });
    };
    const types = new Array<string | null>(pool.candidates.length);
    pool.candidates.forEach((c, i) => {
      if (c.type != null) {
        types[i] = c.type;
        tick();
      }
    });
    const pending = pool.candidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.type == null);
    await mapWithConcurrency(pending, 6, async ({ c, i }) => {
      const t = c.imdbId
        ? await getOmdbTypeById(c.imdbId)
        : await getOmdbTypeByTitle(c.title);
      types[i] = t;
      tick();
    });

    // Pass 1: drop confirmed non-movies. Null = "can't confirm" → keep,
    // so a flaky OMDB request can't delete a legitimate movie. Kept
    // candidates inherit any newly-learned type so the next purge can
    // use the fast path.
    const afterShows: Candidate[] = [];
    let shows = 0;
    let learned = 0;
    pool.candidates.forEach((c, i) => {
      const t = types[i];
      if (t != null && t !== 'movie') {
        shows += 1;
        return;
      }
      if (t != null && c.type !== t) {
        afterShows.push({ ...c, type: t });
        learned += 1;
      } else {
        afterShows.push(c);
      }
    });

    // Pass 2: dedup by loose title key (strips leading articles) so
    // "Lion King" and "The Lion King" collapse into one entry. Prefer
    // the linked candidate when both exist for the same key — imdbId
    // means we already have authoritative RT/IMDb data.
    const byKey = new Map<string, Candidate>();
    let duplicates = 0;
    for (const c of afterShows) {
      const key = dedupKey(c.title);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, c);
        continue;
      }
      duplicates += 1;
      if (c.imdbId && !existing.imdbId) byKey.set(key, c);
    }
    const cleaned = [...byKey.values()];

    if (shows === 0 && duplicates === 0 && learned === 0) {
      setPurge({ kind: 'done', shows: 0, duplicates: 0 });
      return;
    }
    await pool.replaceCandidates(cleaned);
    setPurge({ kind: 'done', shows, duplicates });
  }, [pool]);

  const unlinkedCount = useMemo(
    () => pool.candidates.filter((c) => c.imdbId == null).length,
    [pool.candidates],
  );

  // Score and sort descending. Downvoted candidates naturally sink to the
  // bottom because scoreCandidate subtracts a 1000-point penalty. Stable
  // ties preserve pool insertion order for visual consistency.
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
    if (!q) return ranked;
    return ranked.filter(({ c }) => c.title.toLowerCase().includes(q));
  }, [ranked, query]);

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
              total
              {unlinkedCount > 0 && (
                <>
                  {' · '}
                  <span className="text-ink-300 font-semibold">
                    {unlinkedCount}
                  </span>{' '}
                  unlinked
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

      <div className="px-5 pt-3 pb-1 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void handlePurge()}
          disabled={purge.kind === 'running'}
          className={`w-full min-h-[44px] rounded-2xl text-sm font-semibold transition-colors ${
            purge.kind === 'running'
              ? 'bg-ink-800 border border-ink-700 text-ink-400 cursor-default'
              : 'bg-ink-800 border border-ink-700 text-ink-200 active:bg-ink-700'
          }`}
        >
          {purge.kind === 'running'
            ? `Checking OMDB… (${purge.done}/${purge.total})`
            : 'Clean up pool'}
        </button>
        {purge.kind === 'done' && (
          <p className="text-center text-[11px] text-ink-500 leading-relaxed">
            {summarizePurge(purge.shows, purge.duplicates)}
          </p>
        )}
      </div>

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
          {query
            ? 'No candidates match that search.'
            : 'Pool is empty.'}
        </div>
      )}

      {editing && (
        <EditSheet
          candidate={editing}
          onClose={() => setEditing(null)}
          onSave={async (updated) => {
            await pool.updateCandidate(editing.title, updated);
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
  return (
    <li className="border-b border-ink-800/70">
      <div
        className={`flex gap-3 px-4 py-3.5 ${
          downvoted ? 'opacity-60' : ''
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
              <div className="text-[15px] font-semibold leading-tight text-ink-100 truncate">
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
              {downvoted && (
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
  onSave,
  onClose,
}: {
  candidate: Candidate;
  onSave: (updated: Candidate) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(candidate.title);
  const [yearStr, setYearStr] = useState(
    candidate.year != null ? String(candidate.year) : '',
  );
  const [age, setAge] = useState(candidate.commonSenseAge ?? '');
  const [studio, setStudio] = useState(candidate.studio ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const parsedYear = yearStr.trim() ? parseInt(yearStr, 10) : NaN;
    await onSave({
      ...candidate,
      title: title.trim() || candidate.title,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      commonSenseAge: age.trim() || null,
      studio: studio.trim() || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-ink-950/80 backdrop-blur-sm flex items-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-auto rounded-t-3xl bg-ink-900 border-t border-ink-700 p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink-100">Edit candidate</h2>
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

        <div className="flex flex-col gap-3">
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoCorrect="off"
              className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 focus:outline-none focus:border-amber-glow/60"
            />
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
        </div>

        <div className="mt-4 pt-4 border-t border-ink-800 text-[11px] text-ink-500 leading-relaxed space-y-0.5">
          <ReadOnly label="IMDb ID" value={candidate.imdbId} />
          <ReadOnly label="RT" value={candidate.rottenTomatoes} />
          <ReadOnly label="IMDb" value={candidate.imdb} />
          <ReadOnly label="Awards" value={candidate.awards} />
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

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Returns
 * after every task settles. Used by the purge flow so we don't fire
 * hundreds of parallel OMDB requests — the free tier + mobile radio
 * drops enough under that load that "null = can't confirm" preserves
 * TV shows we meant to remove.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
}

function summarizePurge(shows: number, duplicates: number): string {
  if (shows === 0 && duplicates === 0) return 'Pool is clean.';
  const parts: string[] = [];
  if (shows > 0) parts.push(`${shows} TV show${shows === 1 ? '' : 's'}`);
  if (duplicates > 0) {
    parts.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'}`);
  }
  return `Removed ${parts.join(' and ')}.`;
}

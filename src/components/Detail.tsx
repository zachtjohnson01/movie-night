import { useEffect, useRef, useState } from 'react';
import type { Movie } from '../types';
import {
  ageBadgeClass,
  formatDate,
  formatRelativeTime,
  todayIso,
} from '../format';
import {
  OmdbError,
  commonSenseUrl,
  getMovieById,
  imdbUrl,
  isOmdbConfigured,
  rottenTomatoesUrl,
  type OmdbMoviePatch,
  type OmdbSearchResult,
} from '../omdb';
import MovieSearchCombobox from './MovieSearchCombobox';
import MoviePoster from './MoviePoster';

type Props =
  | {
      mode: 'existing';
      movie: Movie;
      onBack: () => void;
      onUpdate: (updated: Movie) => void | Promise<void>;
      onDelete: (movie: Movie) => void | Promise<void>;
    }
  | {
      mode: 'new';
      movie: Movie; // empty template
      onBack: () => void;
      onCreate: (created: Movie) => void | Promise<void>;
    };

/** Overwrite fields with fresh OMDB data. Used by refresh. */
function applyPatchOverwrite(movie: Movie, patch: OmdbMoviePatch): Movie {
  return {
    ...movie,
    title: patch.title,
    imdbId: patch.imdbId,
    year: patch.year,
    imdb: patch.imdb ?? movie.imdb,
    rottenTomatoes: patch.rottenTomatoes ?? movie.rottenTomatoes,
    poster: patch.poster ?? movie.poster,
    omdbRefreshedAt: new Date().toISOString(),
  };
}

/**
 * Fill in missing fields from OMDB, but never clobber anything the user
 * already set. Used when linking a manually-entered movie for the first
 * time, or when picking a result in the new-movie combobox.
 */
function applyPatchFill(movie: Movie, patch: OmdbMoviePatch): Movie {
  return {
    ...movie,
    title: movie.title.trim() || patch.title,
    imdbId: movie.imdbId ?? patch.imdbId,
    year: movie.year ?? patch.year,
    imdb: movie.imdb ?? patch.imdb,
    rottenTomatoes: movie.rottenTomatoes ?? patch.rottenTomatoes,
    poster: movie.poster ?? patch.poster,
    omdbRefreshedAt: new Date().toISOString(),
  };
}

export default function Detail(props: Props) {
  const isNew = props.mode === 'new';
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Movie>(props.movie);
  const [omdbBusy, setOmdbBusy] = useState(false);
  const [omdbError, setOmdbError] = useState<string | null>(null);
  const [showLinkSearch, setShowLinkSearch] = useState(false);

  // When the parent passes a new movie object (e.g. after a realtime
  // update from Supabase), sync the local draft if we're not actively
  // editing. Keeps the detail view fresh when the other user edits
  // the same movie while we're viewing it.
  if (!editing && props.movie !== draft && draft.title === props.movie.title) {
    if (JSON.stringify(draft) !== JSON.stringify(props.movie)) {
      setDraft(props.movie);
    }
  }

  // Ref to the latest existing-mode movie. The lazy poster backfill uses
  // this at write-time so a concurrent edit from the other user's phone
  // (between fetch start and fetch resolve) isn't clobbered.
  const latestMovieRef = useRef<Movie | null>(null);
  latestMovieRef.current = props.mode === 'existing' ? props.movie : null;

  // Lazy poster backfill: if this movie was linked to OMDB before we
  // started storing posters (imdbId set, poster null), silently fetch it
  // in the background and write it back. Runs once per Detail mount per
  // imdbId — the effect re-checks at write-time to avoid double-writes
  // if the other user's phone beats us to it via realtime sync.
  const backfillImdbId =
    isOmdbConfigured &&
    props.mode === 'existing' &&
    props.movie.imdbId !== null &&
    props.movie.poster === null
      ? props.movie.imdbId
      : null;

  useEffect(() => {
    if (!backfillImdbId) return;
    let cancelled = false;
    (async () => {
      try {
        const patch = await getMovieById(backfillImdbId);
        if (cancelled) return;
        const latest = latestMovieRef.current;
        // Re-check: if the movie was deleted, re-linked, or already
        // backfilled from the other device, do nothing.
        if (
          !latest ||
          latest.imdbId !== backfillImdbId ||
          latest.poster !== null
        ) {
          return;
        }
        if (props.mode !== 'existing') return;
        await props.onUpdate(applyPatchFill(latest, patch));
      } catch {
        // Silent — background operation, no user-facing error.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backfillImdbId]);

  const movie = props.mode === 'existing' ? props.movie : draft;
  const isWatched = movie.watched;

  function startEdit() {
    setDraft(movie);
    setEditing(true);
  }

  function cancelEdit() {
    if (isNew) {
      props.onBack();
      return;
    }
    setEditing(false);
    setDraft(movie);
  }

  async function saveEdit() {
    if (!draft.title.trim()) return;
    if (props.mode === 'new') {
      await props.onCreate(draft);
    } else {
      await props.onUpdate(draft);
      setEditing(false);
    }
  }

  async function markWatchedTonight() {
    if (props.mode !== 'existing') return;
    await props.onUpdate({
      ...movie,
      watched: true,
      dateWatched: todayIso(),
    });
  }

  async function markWatchedUndated() {
    if (props.mode !== 'existing') return;
    await props.onUpdate({ ...movie, watched: true });
  }

  async function saveNotes(notes: string) {
    if (props.mode !== 'existing') return;
    await props.onUpdate({ ...movie, notes: notes || null });
  }

  async function handleDelete() {
    if (props.mode !== 'existing') return;
    const ok = confirm(`Delete "${movie.title}"? This can't be undone.`);
    if (!ok) return;
    await props.onDelete(movie);
  }

  /** Refresh fetches fresh OMDB data by imdbId and overwrites RT/IMDb/year. */
  async function handleRefresh() {
    if (props.mode !== 'existing' || !props.movie.imdbId) return;
    setOmdbBusy(true);
    setOmdbError(null);
    try {
      const patch = await getMovieById(props.movie.imdbId);
      await props.onUpdate(applyPatchOverwrite(props.movie, patch));
    } catch (e) {
      setOmdbError(
        e instanceof OmdbError
          ? e.message
          : (e as Error).message || 'Failed to refresh from OMDB',
      );
    } finally {
      setOmdbBusy(false);
    }
  }

  /**
   * Pick from the search combobox — used in both "link an existing movie"
   * and "populate a new movie". Fetches full details by imdbId and applies
   * them as a fill (never clobbering user-entered data).
   */
  async function handlePickSearchResult(result: OmdbSearchResult) {
    setOmdbBusy(true);
    setOmdbError(null);
    try {
      const patch = await getMovieById(result.imdbId);
      if (props.mode === 'new' || editing) {
        setDraft((prev) => applyPatchFill(prev, patch));
      } else {
        await props.onUpdate(applyPatchFill(props.movie, patch));
      }
      setShowLinkSearch(false);
    } catch (e) {
      setOmdbError(
        e instanceof OmdbError
          ? e.message
          : (e as Error).message || 'Failed to load from OMDB',
      );
    } finally {
      setOmdbBusy(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col">
      <header
        className="sticky top-0 z-10 bg-ink-950/90 backdrop-blur border-b border-ink-800/70"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2 px-2 py-2">
          <button
            type="button"
            onClick={props.onBack}
            className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1 px-2 rounded-xl active:bg-ink-800 text-ink-200"
            aria-label="Back"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span className="text-base font-medium">Back</span>
          </button>
          {!editing ? (
            <button
              type="button"
              onClick={startEdit}
              className="min-h-[44px] px-4 rounded-xl text-amber-glow font-semibold active:bg-ink-800"
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={cancelEdit}
                className="min-h-[44px] px-3 rounded-xl text-ink-300 active:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!draft.title.trim()}
                className="min-h-[44px] px-4 rounded-xl bg-amber-glow text-ink-950 font-semibold active:opacity-80 disabled:opacity-40"
              >
                {isNew ? 'Add' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl w-full px-5 pt-4 pb-28 flex-1">
        {editing ? (
          <EditForm
            draft={draft}
            onChange={setDraft}
            isNew={isNew}
            onPickOmdb={isNew ? handlePickSearchResult : undefined}
            omdbBusy={omdbBusy}
            omdbError={omdbError}
          />
        ) : (
          props.mode === 'existing' && (
            <ViewMode
              movie={movie}
              isWatched={isWatched}
              onMarkWatchedTonight={markWatchedTonight}
              onMarkWatchedUndated={markWatchedUndated}
              onSaveNotes={saveNotes}
              onDelete={handleDelete}
              onRefresh={handleRefresh}
              showLinkSearch={showLinkSearch}
              onToggleLinkSearch={() => {
                setShowLinkSearch((v) => !v);
                setOmdbError(null);
              }}
              onPickLinkResult={handlePickSearchResult}
              omdbBusy={omdbBusy}
              omdbError={omdbError}
            />
          )
        )}
      </main>
    </div>
  );
}

function ViewMode({
  movie,
  isWatched,
  onMarkWatchedTonight,
  onMarkWatchedUndated,
  onSaveNotes,
  onDelete,
  onRefresh,
  showLinkSearch,
  onToggleLinkSearch,
  onPickLinkResult,
  omdbBusy,
  omdbError,
}: {
  movie: Movie;
  isWatched: boolean;
  onMarkWatchedTonight: () => void;
  onMarkWatchedUndated: () => void;
  onSaveNotes: (notes: string) => void;
  onDelete: () => void;
  onRefresh: () => void;
  showLinkSearch: boolean;
  onToggleLinkSearch: () => void;
  onPickLinkResult: (r: OmdbSearchResult) => void;
  omdbBusy: boolean;
  omdbError: string | null;
}) {
  const [notes, setNotes] = useState(movie.notes ?? '');
  const notesDirty = (movie.notes ?? '') !== notes;
  const isLinked = movie.imdbId !== null;
  const [linkQuery, setLinkQuery] = useState(movie.title);

  return (
    <>
      <div className="flex items-start gap-4">
        <MoviePoster movie={movie} size="detail" />
        <div className="flex-1 min-w-0 pt-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight">
            {movie.title}
          </h1>
          {movie.year && (
            <div className="mt-1 text-base font-semibold text-ink-400 tabular-nums">
              {movie.year}
            </div>
          )}
          {isLinked && (
            <span
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-glow/40 bg-amber-glow/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-glow"
              title="Linked to OMDB"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3 h-3"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Linked
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <StatLink
          label="CSM Age"
          value={movie.commonSenseAge}
          href={commonSenseUrl(movie)}
          accent="age"
        />
        <StatLink
          label="RT"
          value={movie.rottenTomatoes}
          href={rottenTomatoesUrl(movie)}
        />
        <StatLink label="IMDb" value={movie.imdb} href={imdbUrl(movie)} />
      </div>

      {isOmdbConfigured && (
        <div className="mt-4 space-y-2">
          {!showLinkSearch && (
            <>
              <button
                type="button"
                onClick={isLinked ? onRefresh : onToggleLinkSearch}
                disabled={omdbBusy}
                className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-ink-100 font-semibold active:bg-ink-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {omdbBusy ? (
                  <>
                    <Spinner />
                    <span>Working…</span>
                  </>
                ) : isLinked ? (
                  <>
                    <RefreshIcon />
                    <span>Refresh from OMDB</span>
                  </>
                ) : (
                  <>
                    <LinkIcon />
                    <span>Link to OMDB</span>
                  </>
                )}
              </button>
              {movie.omdbRefreshedAt && (
                <p className="text-center text-xs text-ink-500">
                  Last refreshed {formatRelativeTime(movie.omdbRefreshedAt)}
                </p>
              )}
            </>
          )}

          {showLinkSearch && (
            <div className="rounded-2xl bg-ink-900/70 border border-ink-800 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
                Find this movie on OMDB
              </div>
              <MovieSearchCombobox
                value={linkQuery}
                onChange={setLinkQuery}
                onPick={onPickLinkResult}
              />
              <button
                type="button"
                onClick={onToggleLinkSearch}
                className="w-full min-h-[40px] text-sm text-ink-400 active:text-ink-200"
              >
                Cancel
              </button>
            </div>
          )}

          {omdbError && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-xs text-rose-200">
              {omdbError}
            </div>
          )}
        </div>
      )}

      {isWatched ? (
        <section className="mt-8">
          <div className="text-xs uppercase tracking-[0.2em] text-ink-500 font-semibold">
            Watched
          </div>
          <div className="mt-1 text-lg text-ink-100 font-semibold">
            {movie.dateWatched ? (
              formatDate(movie.dateWatched)
            ) : (
              <span className="text-ink-400 italic">Date unknown</span>
            )}
          </div>
          {!movie.dateWatched && (
            <p className="mt-2 text-xs text-ink-500">
              Tap Edit to set the date when you remember it.
            </p>
          )}

          <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-ink-500 font-semibold">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Favorite scenes, reactions, the moment she gasped…"
            rows={6}
            className="mt-2 w-full rounded-2xl bg-ink-800 border border-ink-700 p-4 text-base leading-relaxed placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
          />
          <button
            type="button"
            disabled={!notesDirty}
            onClick={() => onSaveNotes(notes)}
            className="mt-3 w-full min-h-[52px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80 disabled:opacity-40 disabled:active:opacity-40"
          >
            Save notes
          </button>
        </section>
      ) : (
        <section className="mt-10 space-y-3">
          <button
            type="button"
            onClick={onMarkWatchedTonight}
            className="w-full min-h-[60px] rounded-2xl bg-crimson-deep text-white text-lg font-semibold tracking-wide shadow-lg shadow-crimson-deep/20 active:bg-crimson-bright active:opacity-95"
          >
            Mark as watched tonight
          </button>
          <p className="text-center text-xs text-ink-500">
            Sets the date to today ({formatDate(todayIso())}).
          </p>
          <button
            type="button"
            onClick={onMarkWatchedUndated}
            className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-ink-200 font-semibold active:bg-ink-700"
          >
            Mark watched · date unknown
          </button>
        </section>
      )}

      <section className="mt-12 pt-6 border-t border-ink-800/70">
        <button
          type="button"
          onClick={onDelete}
          className="w-full min-h-[48px] rounded-2xl text-rose-400 font-medium active:bg-rose-950/40"
        >
          Delete movie
        </button>
      </section>
    </>
  );
}

function StatLink({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: string | null;
  href: string;
  accent?: 'age';
}) {
  const pillClass =
    accent === 'age' && value
      ? ageBadgeClass(value)
      : 'bg-ink-800 border-ink-700 text-ink-100';
  // Make the whole card tappable. Even when `value` is null we still link
  // out so the user can look it up at the source and fill it in manually.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl bg-ink-900/70 border border-ink-800 p-3 active:bg-ink-800/80 transition-colors"
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
        {label}
      </div>
      <div className="mt-2">
        {value ? (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums ${pillClass}`}
          >
            {value}
          </span>
        ) : (
          <span className="text-ink-500 text-sm italic">Look up ↗</span>
        )}
      </div>
    </a>
  );
}

function EditForm({
  draft,
  onChange,
  isNew,
  onPickOmdb,
  omdbBusy,
  omdbError,
}: {
  draft: Movie;
  onChange: (m: Movie) => void;
  isNew: boolean;
  onPickOmdb?: (r: OmdbSearchResult) => void;
  omdbBusy: boolean;
  omdbError: string | null;
}) {
  function update<K extends keyof Movie>(key: K, value: Movie[K]) {
    onChange({ ...draft, [key]: value });
  }

  // Treat blank strings as null for optional fields.
  function updateStr(key: keyof Movie, raw: string) {
    const v = raw.trim() === '' ? null : raw;
    onChange({ ...draft, [key]: v } as Movie);
  }

  return (
    <div className="space-y-5">
      {isNew && (
        <div className="text-sm text-ink-400">
          {isOmdbConfigured
            ? 'Start typing a title — we’ll search OMDB for matches. Pick one to auto-fill the ratings.'
            : 'Fill in whatever you know. Only the title is required.'}
        </div>
      )}

      <Field label="Title">
        {isNew && onPickOmdb ? (
          <MovieSearchCombobox
            value={draft.title}
            onChange={(v) => update('title', v)}
            onPick={onPickOmdb}
            autoFocus
          />
        ) : (
          <input
            type="text"
            value={draft.title}
            onChange={(e) => update('title', e.target.value)}
            className={inputClass}
            placeholder="Movie title"
            autoCorrect="off"
          />
        )}
      </Field>

      {omdbBusy && (
        <div className="flex items-center gap-2 text-sm text-ink-400">
          <Spinner />
          Fetching details from OMDB…
        </div>
      )}
      {omdbError && (
        <div className="rounded-xl bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-xs text-rose-200">
          {omdbError}
        </div>
      )}
      {isNew && draft.imdbId && (
        <div className="inline-flex items-center gap-1 rounded-full border border-amber-glow/40 bg-amber-glow/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-glow">
          ✓ Linked to OMDB
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="CSM Age">
          <input
            type="text"
            inputMode="text"
            placeholder="6+"
            value={draft.commonSenseAge ?? ''}
            onChange={(e) => updateStr('commonSenseAge', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="RT">
          <input
            type="text"
            placeholder="97%"
            value={draft.rottenTomatoes ?? ''}
            onChange={(e) => updateStr('rottenTomatoes', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="IMDb">
          <input
            type="text"
            placeholder="7.9"
            value={draft.imdb ?? ''}
            onChange={(e) => updateStr('imdb', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Status">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => update('watched', false)}
            className={`min-h-[48px] rounded-2xl border font-semibold ${
              !draft.watched
                ? 'bg-amber-glow/20 border-amber-glow/60 text-amber-glow'
                : 'bg-ink-800 border-ink-700 text-ink-300'
            }`}
          >
            Wishlist
          </button>
          <button
            type="button"
            onClick={() => update('watched', true)}
            className={`min-h-[48px] rounded-2xl border font-semibold ${
              draft.watched
                ? 'bg-amber-glow/20 border-amber-glow/60 text-amber-glow'
                : 'bg-ink-800 border-ink-700 text-ink-300'
            }`}
          >
            Watched
          </button>
        </div>
      </Field>

      {draft.watched && (
        <Field label="Date watched (optional)">
          <input
            type="date"
            value={draft.dateWatched ?? ''}
            onChange={(e) => updateStr('dateWatched', e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-500">
            Leave blank if you don&apos;t remember.
          </p>
        </Field>
      )}

      <Field label="Notes">
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => updateStr('notes', e.target.value)}
          rows={6}
          className={`${inputClass} leading-relaxed`}
          placeholder="Favorite scenes, reactions, the moment she gasped…"
        />
      </Field>
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
    <label className="block">
      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-500 font-semibold mb-2">
        {label}
      </div>
      {children}
    </label>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="w-4 h-4 animate-spin text-ink-300"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.76 5.24" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

const inputClass =
  'w-full rounded-2xl bg-ink-800 border border-ink-700 px-4 py-3 text-base focus:outline-none focus:border-amber-glow/60';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Movie } from '../types';
import {
  buildShareData,
  computeCrossovers,
  formatDate,
  formatRelativeTime,
  getDisplayTitle,
  parseNameList,
  todayIso,
} from '../format';
import ShareButton from './ShareButton';
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
import StatLink from './StatLink';
import CreatorPills from './CreatorPills';
import { verifyField, type VerifyResult } from '../verify';

type Props =
  | {
      mode: 'existing';
      canWrite: boolean;
      isOwner?: boolean;
      movie: Movie;
      library?: Movie[];
      onBack: () => void;
      onUpdate: (updated: Movie) => void | Promise<void>;
      onDelete: (movie: Movie) => void | Promise<void>;
      onSelectMovie?: (title: string) => void;
    }
  | {
      mode: 'new';
      canWrite: boolean;
      movie: Movie; // empty template
      onBack: () => void;
      onCreate: (created: Movie) => void | Promise<void>;
    }
  | {
      mode: 'candidate';
      canWrite: boolean;
      movie: Movie; // template from candidateToTemplate
      library?: Movie[];
      /** Live downvote state from the candidate pool, null if not in the pool. */
      downvoted?: boolean;
      onBack: () => void;
      onAddToWishlist: (movie: Movie) => void | Promise<void>;
      onMarkWatchedTonight: (movie: Movie) => void | Promise<void>;
      onMarkWatchedUndated: (movie: Movie) => void | Promise<void>;
      onToggleDownvote?: () => void | Promise<void>;
      onSelectMovie?: (title: string) => void;
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
    awards: patch.awards ?? movie.awards,
    production: patch.production ?? movie.production,
    directors: patch.directors ?? movie.directors,
    writers: patch.writers ?? movie.writers,
    omdbRefreshedAt: new Date().toISOString(),
  };
}

/**
 * Fill in missing fields from OMDB. Used when linking a manually-entered
 * movie for the first time, when picking a result in the new-movie
 * combobox, or during the lazy poster backfill.
 *
 * The title always gets rewritten to OMDB's canonical version, even if
 * the user already typed one — so "A Bugs Life" becomes "A Bug's Life"
 * after linking, and "Totoro" becomes "My Neighbor Totoro". The user
 * explicitly asked for this because they want external IMDb/RT links
 * to match the movie's display name and to avoid drift over time.
 *
 * All other fields follow fill semantics: user-entered values are
 * preserved, only `null`/`undefined` gets replaced with patch data.
 * Notes, dateWatched, watched status, and CSM age are never touched —
 * OMDB doesn't know about those anyway.
 */
function applyPatchFill(movie: Movie, patch: OmdbMoviePatch): Movie {
  return {
    ...movie,
    title: patch.title,
    imdbId: movie.imdbId ?? patch.imdbId,
    year: movie.year ?? patch.year,
    imdb: movie.imdb ?? patch.imdb,
    rottenTomatoes: movie.rottenTomatoes ?? patch.rottenTomatoes,
    poster: movie.poster ?? patch.poster,
    awards: movie.awards ?? patch.awards,
    production: movie.production ?? patch.production,
    directors: movie.directors ?? patch.directors,
    writers: movie.writers ?? patch.writers,
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

  // Scroll to the top of the page whenever Detail mounts. The app is a
  // stateless SPA — switching between list and detail views is just
  // React rendering different components into the same browser window,
  // so the body scroll position persists from wherever you were in the
  // list. Without this, tapping a movie halfway down the list dropped
  // you into the middle of the Detail screen (often below the poster
  // and title).
  //
  // Be defensive because a single scrollTo during useLayoutEffect was
  // observed to be undone on iOS Safari PWA — probably a combination
  // of CSS scroll anchoring (disabled globally in index.css now) and
  // layout-shift-on-mount quirks. Reset via both `window.scrollTo`
  // and `document.scrollingElement.scrollTop`, AND retry on the next
  // animation frame in case something shifts scroll between the
  // synchronous effect and the first paint.
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
  // started storing posters (imdbId set, poster null or *undefined*),
  // silently fetch it in the background and write it back.
  //
  // Uses `== null` (loose equality) instead of `=== null` on purpose:
  // movies linked during PR #5 were written without a `poster` key at
  // all, so reading the field returns `undefined` — not `null`. A
  // strict `=== null` check misses them entirely and the effect never
  // fires. `== null` matches both.
  const backfillImdbId =
    isOmdbConfigured &&
    props.mode === 'existing' &&
    props.movie.imdbId != null &&
    props.movie.poster == null
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
        // backfilled from the other device, do nothing. Uses `!= null`
        // for the poster check to match the initial condition above.
        if (
          !latest ||
          latest.imdbId !== backfillImdbId ||
          latest.poster != null
        ) {
          return;
        }
        if (props.mode !== 'existing') return;
        await props.onUpdate(applyPatchFill(latest, patch));
      } catch (e) {
        // Surface backfill errors so we can actually see why this
        // silently isn't working. Prefixed with "Auto-fill" to
        // distinguish from user-triggered Refresh errors.
        if (cancelled) return;
        setOmdbError(
          `Auto-fill failed: ${
            e instanceof OmdbError
              ? e.message
              : (e as Error).message || 'unknown error'
          }`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backfillImdbId]);

  const movie = props.mode === 'new' ? draft : props.movie;
  const isWatched = movie.watched;

  // Override the page's og:image / og:title (and Twitter equivalents)
  // while a Detail with a known poster is open so the iOS Share Sheet
  // preview card — which reads the current document, not /api/share —
  // shows the movie's poster and "Title (Year)" instead of the static
  // play-button icon. iMessage's after-send unfurl is handled
  // separately by api/share.ts. Restore originals on unmount/change.
  const sharePoster = movie.poster;
  const shareTitle = movie.poster
    ? `${getDisplayTitle(movie)}${movie.year ? ` (${movie.year})` : ''}`
    : null;
  useEffect(() => {
    if (!sharePoster || !shareTitle) return;
    const targets: Array<{
      el: Element | null;
      attr: 'content';
      next: string;
    }> = [
      { el: document.querySelector('meta[property="og:image"]'), attr: 'content', next: sharePoster },
      { el: document.querySelector('meta[name="twitter:image"]'), attr: 'content', next: sharePoster },
      { el: document.querySelector('meta[property="og:title"]'), attr: 'content', next: shareTitle },
      { el: document.querySelector('meta[name="twitter:title"]'), attr: 'content', next: shareTitle },
    ];
    const originals = targets.map((t) => ({
      el: t.el,
      attr: t.attr,
      prev: t.el?.getAttribute(t.attr) ?? null,
    }));
    targets.forEach((t) => t.el?.setAttribute(t.attr, t.next));
    return () => {
      originals.forEach((o) => {
        if (o.prev !== null) o.el?.setAttribute(o.attr, o.prev);
      });
    };
  }, [sharePoster, shareTitle]);

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
    } else if (props.mode === 'existing') {
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
    const ok = confirm(
      movie.watched
        ? `Remove "${getDisplayTitle(movie)}" from your watched list?`
        : `Remove "${getDisplayTitle(movie)}" from your wishlist?`,
    );
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
   * Pick from the search combobox — used in the new-movie add flow, the
   * "Link to OMDB" button flow, AND the Title field in edit mode.
   *
   * Uses `applyPatchOverwrite` rather than `applyPatchFill` because the
   * user has explicitly chosen this specific OMDB result, so we trust
   * their choice and rewrite imdbId + all metric fields to the new
   * match. Fill semantics would preserve a stale imdbId from a
   * previous wrong link, which was exactly the "relink" bug from the
   * Dog Man → Man Bites Dog incident.
   *
   * Non-OMDB fields (notes, dateWatched, watched, commonSenseAge) are
   * still preserved via the spread inside applyPatchOverwrite.
   */
  async function handlePickSearchResult(result: OmdbSearchResult) {
    setOmdbBusy(true);
    setOmdbError(null);
    try {
      const patch = await getMovieById(result.imdbId);
      if (props.mode === 'new' || editing) {
        setDraft((prev) => applyPatchOverwrite(prev, patch));
      } else if (props.mode === 'existing') {
        await props.onUpdate(applyPatchOverwrite(props.movie, patch));
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
            <div className="flex items-center gap-1">
              <ShareButton
                data={buildShareData(movie, window.location.origin)}
              />
              {props.canWrite && props.mode !== 'candidate' && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="min-h-[44px] px-4 rounded-xl text-amber-glow font-semibold active:bg-ink-800"
                >
                  Edit
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {draft.title.trim() && (
                <ShareButton
                  data={buildShareData(draft, window.location.origin)}
                />
              )}
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
            onPickOmdb={handlePickSearchResult}
            omdbBusy={omdbBusy}
            omdbError={omdbError}
          />
        ) : props.mode === 'existing' ? (
          <ViewMode
            variant="existing"
            movie={movie}
            isWatched={isWatched}
            canWrite={props.canWrite}
            isOwner={props.isOwner ?? false}
            library={props.library}
            onSelectMovie={props.onSelectMovie}
            onMarkWatchedTonight={markWatchedTonight}
            onMarkWatchedUndated={markWatchedUndated}
            onSaveNotes={saveNotes}
            onUpdate={props.onUpdate}
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
        ) : props.mode === 'candidate' ? (
          <ViewMode
            variant="candidate"
            movie={movie}
            canWrite={props.canWrite}
            library={props.library}
            onSelectMovie={props.onSelectMovie}
            onAddToWishlist={() => props.onAddToWishlist(props.movie)}
            onMarkWatchedTonight={() => props.onMarkWatchedTonight(props.movie)}
            onMarkWatchedUndated={() => props.onMarkWatchedUndated(props.movie)}
            downvoted={!!props.downvoted}
            onToggleDownvote={props.onToggleDownvote ?? null}
          />
        ) : null}
      </main>
    </div>
  );
}

type ViewModeProps = {
  movie: Movie;
  canWrite: boolean;
  library?: Movie[];
  onSelectMovie?: (title: string) => void;
} & (
  | {
      variant: 'existing';
      isWatched: boolean;
      isOwner: boolean;
      onMarkWatchedTonight: () => void;
      onMarkWatchedUndated: () => void;
      onSaveNotes: (notes: string) => void;
      onUpdate: (updated: Movie) => void | Promise<void>;
      onDelete: () => void;
      onRefresh: () => void;
      showLinkSearch: boolean;
      onToggleLinkSearch: () => void;
      onPickLinkResult: (r: OmdbSearchResult) => void;
      omdbBusy: boolean;
      omdbError: string | null;
    }
  | {
      variant: 'candidate';
      onAddToWishlist: () => void;
      onMarkWatchedTonight: () => void;
      onMarkWatchedUndated: () => void;
      downvoted: boolean;
      onToggleDownvote: (() => void) | null;
    }
);

function ViewMode(props: ViewModeProps) {
  const { movie, canWrite, variant } = props;
  const [notes, setNotes] = useState(movie.notes ?? '');
  const notesDirty = (movie.notes ?? '') !== notes;
  // Use loose inequality so movies whose Supabase row literally has no
  // `imdbId` key (everything from the initial pre-PR-#5 seed) are
  // correctly treated as unlinked. Strict `!== null` would return true
  // for `undefined`, which made every seed movie falsely show the
  // "Linked" badge and surface "Refresh from OMDB" on a button that
  // would silently do nothing.
  const isLinked = movie.imdbId != null;
  const [linkQuery, setLinkQuery] = useState(movie.title);

  return (
    <>
      <div className="flex items-start gap-4">
        <MoviePoster movie={movie} size="detail" />
        <div className="flex-1 min-w-0 pt-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight">
            {getDisplayTitle(movie)}
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

      <StudioAwardsBlock movie={movie} />

      {variant === 'existing' && props.isOwner && canWrite && movie.imdbId && (
        <VerifyBlock movie={movie} onUpdate={props.onUpdate} />
      )}

      {variant === 'existing' && isOmdbConfigured && (
        <div className="mt-4 space-y-2">
          {!props.showLinkSearch && (
            <>
              <button
                type="button"
                onClick={isLinked ? props.onRefresh : props.onToggleLinkSearch}
                disabled={props.omdbBusy}
                className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-ink-100 font-semibold active:bg-ink-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {props.omdbBusy ? (
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

          {props.showLinkSearch && (
            <div className="rounded-2xl bg-ink-900/70 border border-ink-800 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
                Find this movie on OMDB
              </div>
              <MovieSearchCombobox
                value={linkQuery}
                onChange={setLinkQuery}
                onPick={props.onPickLinkResult}
                autoOpen
              />
              <button
                type="button"
                onClick={props.onToggleLinkSearch}
                className="w-full min-h-[40px] text-sm text-ink-400 active:text-ink-200"
              >
                Cancel
              </button>
            </div>
          )}

          {props.omdbError && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-xs text-rose-200">
              {props.omdbError}
            </div>
          )}
        </div>
      )}

      {props.library && (
        <CrossoverBlock
          movie={movie}
          library={props.library}
          onSelectMovie={props.onSelectMovie}
        />
      )}

      {variant === 'existing' &&
        (props.isWatched ? (
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
            {!movie.dateWatched && canWrite && (
              <p className="mt-2 text-xs text-ink-500">
                Tap Edit to set the date when you remember it.
              </p>
            )}

            <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-ink-500 font-semibold">
              Notes
            </label>
            {canWrite ? (
              <>
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
                  onClick={() => props.onSaveNotes(notes)}
                  className="mt-3 w-full min-h-[52px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80 disabled:opacity-40 disabled:active:opacity-40"
                >
                  Save notes
                </button>
              </>
            ) : movie.notes ? (
              <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-ink-900/60 border border-ink-800 p-4 text-base leading-relaxed text-ink-200">
                {movie.notes}
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink-500 italic">No notes yet.</p>
            )}
          </section>
        ) : (
          canWrite && (
            <section className="mt-10 space-y-3">
              <button
                type="button"
                onClick={props.onMarkWatchedTonight}
                className="w-full min-h-[60px] rounded-2xl bg-crimson-deep text-white text-lg font-semibold tracking-wide shadow-lg shadow-crimson-deep/20 active:bg-crimson-bright active:opacity-95"
              >
                Mark as watched tonight ({formatDate(todayIso())})
              </button>
              <button
                type="button"
                onClick={props.onMarkWatchedUndated}
                className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-ink-200 font-semibold active:bg-ink-700"
              >
                Mark watched · date unknown
              </button>
            </section>
          )
        ))}

      {variant === 'candidate' && canWrite && (
        <section className="mt-10 space-y-3">
          <button
            type="button"
            onClick={props.onAddToWishlist}
            className="w-full min-h-[60px] rounded-2xl bg-crimson-deep text-white text-lg font-semibold tracking-wide shadow-lg shadow-crimson-deep/20 active:bg-crimson-bright active:opacity-95"
          >
            Add to queue
          </button>
          <button
            type="button"
            onClick={props.onMarkWatchedTonight}
            className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-ink-200 font-semibold active:bg-ink-700"
          >
            Mark watched tonight ({formatDate(todayIso())})
          </button>
          <button
            type="button"
            onClick={props.onMarkWatchedUndated}
            className="w-full min-h-[48px] rounded-2xl bg-ink-800 border border-ink-700 text-ink-200 font-semibold active:bg-ink-700"
          >
            Mark watched · date unknown
          </button>
          {props.onToggleDownvote && (
            <button
              type="button"
              onClick={props.onToggleDownvote}
              aria-pressed={props.downvoted}
              className={`mt-2 w-full min-h-[48px] rounded-2xl font-semibold flex items-center justify-center gap-2 transition-colors ${
                props.downvoted
                  ? 'bg-crimson-deep/20 border border-crimson-deep text-crimson-bright active:bg-crimson-deep/30'
                  : 'bg-ink-900 border border-ink-800 text-ink-400 active:bg-ink-800'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width={18}
                height={18}
                fill={props.downvoted ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M17 14V2" />
                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11l-3.17 6.34A1.94 1.94 0 0 1 10.55 22 2.55 2.55 0 0 1 8 19.46a2.84 2.84 0 0 1 .1-.82Z" />
              </svg>
              {props.downvoted
                ? 'Downvoted — tap to undo'
                : 'Downvote this pick'}
            </button>
          )}
        </section>
      )}

      {variant === 'existing' && canWrite && (
        <section className="mt-12 pt-6 border-t border-ink-800/70">
          <button
            type="button"
            onClick={props.onDelete}
            className="w-full min-h-[48px] rounded-2xl text-rose-400 font-medium active:bg-rose-950/40"
          >
            {movie.watched ? 'Remove from watched list' : 'Remove from queue'}
          </button>
        </section>
      )}
    </>
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
      <div className="flex justify-center">
        <MoviePoster movie={draft} size="detail" />
      </div>

      {isNew && (
        <div className="text-sm text-ink-400">
          {isOmdbConfigured
            ? 'Start typing a title — we’ll search OMDB for matches. Pick one to auto-fill the ratings.'
            : 'Fill in whatever you know. Only the title is required.'}
        </div>
      )}

      <Field label="Title">
        {onPickOmdb && isOmdbConfigured ? (
          <MovieSearchCombobox
            value={draft.title}
            onChange={(v) => update('title', v)}
            onPick={onPickOmdb}
            autoFocus={isNew && !draft.title.trim()}
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

      <Field label="Display title (optional)">
        <input
          type="text"
          value={draft.displayTitle ?? ''}
          onChange={(e) => updateStr('displayTitle', e.target.value)}
          className={inputClass}
          placeholder="e.g. Lotte from Gadgetville"
          autoCorrect="off"
        />
        <p className="mt-1 text-xs text-ink-500 leading-snug">
          Overrides how the movie is shown in the app. Useful when OMDB
          has an original-language title (like &ldquo;Leiutajateküla
          Lotte&rdquo;) but you watched the English release. Leave
          blank to use the title above.
        </p>
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
      {draft.imdbId && (
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-full border border-amber-glow/40 bg-amber-glow/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-glow">
            ✓ Linked to OMDB
          </div>
          {!isNew && (
            <button
              type="button"
              onClick={() => {
                // Break the stale link so the user can manually re-pick
                // a new OMDB match. Clears all OMDB-sourced fields but
                // keeps the user-maintained ones (notes, dateWatched,
                // watched, CSM age).
                onChange({
                  ...draft,
                  imdbId: null,
                  year: null,
                  poster: null,
                  omdbRefreshedAt: null,
                  directors: null,
                  writers: null,
                });
              }}
              className="text-xs text-ink-400 underline-offset-2 hover:underline active:text-ink-200"
            >
              Unlink
            </button>
          )}
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

      <Field label="Studio">
        <input
          type="text"
          value={draft.production ?? ''}
          onChange={(e) => updateStr('production', e.target.value)}
          className={inputClass}
          placeholder="e.g. Pixar Animation Studios"
          autoCorrect="off"
        />
      </Field>

      <Field label="Directors">
        <CreatorPills
          names={draft.directors}
          onChange={(next) => update('directors', next)}
          placeholder="e.g. Hayao Miyazaki (comma-separates multiple)"
        />
      </Field>

      <Field label="Writers">
        <CreatorPills
          names={draft.writers}
          onChange={(next) => update('writers', next)}
          placeholder="e.g. Hayao Miyazaki (comma-separates multiple)"
        />
      </Field>

      <Field label="Awards">
        <textarea
          value={draft.awards ?? ''}
          onChange={(e) => updateStr('awards', e.target.value)}
          rows={3}
          className={`${inputClass} leading-relaxed`}
          placeholder="e.g. Won 1 Oscar. 14 wins & 13 nominations."
        />
      </Field>

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
            Up Next
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

function StudioAwardsBlock({ movie }: { movie: Movie }) {
  return (
    <div className="mt-5 rounded-2xl bg-ink-900/70 border border-ink-800 p-4 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
          {movie.directors && movie.directors.length > 1 ? 'Directors' : 'Director'}
        </div>
        <div className="mt-1 leading-snug">
          <CreatorPills readOnly names={movie.directors} />
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
          {movie.writers && movie.writers.length > 1 ? 'Writers' : 'Writer'}
        </div>
        <div className="mt-1 leading-snug">
          <CreatorPills readOnly names={movie.writers} />
        </div>
      </div>
      {movie.production && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
            Studio
          </div>
          <div className="mt-1 text-sm text-ink-200 leading-snug">
            {movie.production}
          </div>
        </div>
      )}
      {movie.awards && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
            Awards
          </div>
          <div className="mt-1 text-sm text-amber-glow/90 leading-snug">
            {movie.awards}
          </div>
        </div>
      )}
    </div>
  );
}

function CrossoverBlock({
  movie,
  library,
  onSelectMovie,
}: {
  movie: Movie;
  library: Movie[];
  onSelectMovie?: (title: string) => void;
}) {
  const { studioMatches, directorMatches, writerMatches } = computeCrossovers(
    movie,
    library,
  );
  if (
    studioMatches.length === 0 &&
    directorMatches.length === 0 &&
    writerMatches.length === 0
  ) {
    return null;
  }

  return (
    <div className="mt-5 rounded-2xl bg-ink-900/70 border border-ink-800 p-4 space-y-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
        Also in your watched list
      </div>
      {studioMatches.length > 0 && (
        <CrossoverSection
          label="Studio"
          matches={studioMatches}
          trailing={(m) => m.production ?? null}
          onSelectMovie={onSelectMovie}
        />
      )}
      {directorMatches.length > 0 && (
        <CrossoverSection
          label={directorMatches.length > 1 ? 'Directors' : 'Director'}
          matches={directorMatches}
          trailing={(m) => m.directors?.join(', ') ?? null}
          onSelectMovie={onSelectMovie}
        />
      )}
      {writerMatches.length > 0 && (
        <CrossoverSection
          label={writerMatches.length > 1 ? 'Writers' : 'Writer'}
          matches={writerMatches}
          trailing={(m) => m.writers?.join(', ') ?? null}
          onSelectMovie={onSelectMovie}
        />
      )}
    </div>
  );
}

function CrossoverSection({
  label,
  matches,
  trailing,
  onSelectMovie,
}: {
  label: string;
  matches: Movie[];
  trailing: (m: Movie) => string | null;
  onSelectMovie?: (title: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
        {label}
      </div>
      <ul className="mt-1 divide-y divide-ink-800/70">
        {matches.map((m) => {
          const title = getDisplayTitle(m);
          const year = m.year;
          const tail = trailing(m);
          const content = (
            <div className="flex flex-col text-left">
              <span className="text-sm text-ink-100 leading-snug">
                {title}
                {year != null && (
                  <span className="ml-1 text-ink-400 tabular-nums">
                    ({year})
                  </span>
                )}
              </span>
              {tail && (
                <span className="text-xs text-ink-400 leading-snug">
                  {tail}
                </span>
              )}
            </div>
          );
          return (
            <li key={m.imdbId ?? m.title}>
              {onSelectMovie ? (
                <button
                  type="button"
                  onClick={() => onSelectMovie(m.title)}
                  className="w-full min-h-[44px] py-2 active:bg-ink-800/60 rounded-lg px-1 -mx-1"
                >
                  {content}
                </button>
              ) : (
                <div className="py-2 px-1 -mx-1">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const VERIFY_FIELD_LABEL: Record<
  NonNullable<VerifyResult['field']>,
  string
> = {
  production: 'Studio',
  awards: 'Awards',
  year: 'Year',
  commonSenseAge: 'CSM Age',
  director: 'Director',
  writer: 'Writer',
};

function VerifyBlock({
  movie,
  onUpdate,
}: {
  movie: Movie;
  onUpdate: (updated: Movie) => void | Promise<void>;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await verifyField(movie, q);
      setResult(r);
    } catch (e) {
      setError((e as Error).message || 'Failed to ask Claude');
    } finally {
      setBusy(false);
    }
  }

  // Coerce Claude's string suggestion to the right type for the Movie field.
  // Year has to be a number; director/writer map to the new array fields
  // after splitting commas; everything else stays a string.
  function buildUpdate(
    r: VerifyResult & { field: NonNullable<VerifyResult['field']>; suggestedValue: string },
  ): Movie | null {
    if (r.field === 'year') {
      const n = Number.parseInt(r.suggestedValue, 10);
      if (!Number.isFinite(n)) return null;
      return { ...movie, year: n };
    }
    if (r.field === 'director') {
      return { ...movie, directors: parseNameList(r.suggestedValue) };
    }
    if (r.field === 'writer') {
      return { ...movie, writers: parseNameList(r.suggestedValue) };
    }
    return { ...movie, [r.field]: r.suggestedValue };
  }

  async function applyUpdate() {
    if (!result || !result.field || !result.suggestedValue) return;
    const next = buildUpdate(
      result as VerifyResult & {
        field: NonNullable<VerifyResult['field']>;
        suggestedValue: string;
      },
    );
    if (!next) {
      setError('Claude’s suggested value isn’t usable for that field.');
      return;
    }
    await onUpdate(next);
    setResult(null);
    setQuestion('');
  }

  const canUpdate =
    !!result &&
    !!result.field &&
    !!result.suggestedValue &&
    !result.matches &&
    !(result.field === 'year' &&
      !Number.isFinite(Number.parseInt(result.suggestedValue, 10)));

  return (
    <div className="mt-5 rounded-2xl bg-ink-900/70 border border-ink-800 p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
        Ask Claude to verify
      </div>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        className={`${inputClass} leading-relaxed`}
        placeholder='e.g. "What studio made this?" or "Did it win any Oscars?"'
      />
      <button
        type="button"
        onClick={ask}
        disabled={!question.trim() || busy}
        className="w-full min-h-[48px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {busy ? (
          <>
            <Spinner />
            <span>Asking…</span>
          </>
        ) : (
          <span>Ask Claude</span>
        )}
      </button>

      {error && (
        <div className="rounded-xl bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {result && !error && (
        <VerifyResultView
          result={result}
          canUpdate={canUpdate}
          onApply={applyUpdate}
          onDismiss={() => setResult(null)}
        />
      )}
    </div>
  );
}

function VerifyResultView({
  result,
  canUpdate,
  onApply,
  onDismiss,
}: {
  result: VerifyResult;
  canUpdate: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  // Question didn't map to a verifiable field, or Claude wasn't confident
  // enough to suggest a value. Show the explanation and a dismiss button.
  if (!result.field || !result.suggestedValue) {
    return (
      <div className="rounded-xl bg-ink-800/70 border border-ink-700 p-3 space-y-3">
        <p className="text-sm text-ink-200 leading-relaxed">
          {result.explanation || 'No confident answer.'}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="w-full min-h-[44px] rounded-xl bg-ink-800 border border-ink-700 text-ink-300 font-medium active:bg-ink-700"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const label = VERIFY_FIELD_LABEL[result.field];

  if (result.matches) {
    return (
      <div className="rounded-xl bg-ink-800/70 border border-ink-700 p-3 space-y-3">
        <div className="text-xs text-ink-400">
          Matches what we have for{' '}
          <span className="text-ink-200 font-semibold">{label}</span>:
        </div>
        <div className="text-sm text-ink-100 leading-snug">
          {result.suggestedValue}
        </div>
        {result.explanation && (
          <p className="text-xs text-ink-400 leading-relaxed">
            {result.explanation}
          </p>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="w-full min-h-[44px] rounded-xl bg-ink-800 border border-ink-700 text-ink-300 font-medium active:bg-ink-700"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-ink-800/70 border border-ink-700 p-3 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
          {label}
        </div>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <span className="text-ink-400">Currently</span>
          <span className="text-ink-200">
            {result.currentValue ?? (
              <span className="italic text-ink-500">blank</span>
            )}
          </span>
          <span className="text-ink-400">Claude says</span>
          <span className="text-amber-glow font-semibold">
            {result.suggestedValue}
          </span>
        </div>
      </div>
      {result.explanation && (
        <p className="text-xs text-ink-400 leading-relaxed">
          {result.explanation}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[44px] rounded-xl bg-ink-800 border border-ink-700 text-ink-300 font-medium active:bg-ink-700"
        >
          No
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!canUpdate}
          className="min-h-[44px] rounded-xl bg-amber-glow text-ink-950 font-semibold active:opacity-80 disabled:opacity-40"
        >
          Yes, update
        </button>
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

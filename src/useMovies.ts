import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import seed from '../movies.json';
import { coerceCreatorLists } from './format';
import type { Candidate, LibraryEntry, Movie } from './types';
import {
  isSupabaseConfigured,
  supabase,
  MOVIE_NIGHT_TABLE,
} from './supabase';

const SEED: Movie[] = (seed as unknown[])
  .map(coerceCreatorLists)
  .map((m) => {
    const movie = m as Movie;
    return { ...movie, id: movie.id ?? null, favorite: movie.favorite ?? false };
  }) as Movie[];

export type SyncStatus = 'local' | 'loading' | 'synced' | 'error';

export type MoviesApi = {
  movies: Movie[];
  status: SyncStatus;
  updateMovie: (originalTitle: string, updated: Movie) => Promise<void>;
  addMovie: (movie: Movie) => Promise<void>;
  deleteMovie: (id: string) => Promise<void>;
  reorderWishlist: (orderedTitles: string[]) => Promise<void>;
  reload: () => void;
};

// --- Migration detection ---

export function isOldMovieFormat(data: unknown[]): boolean {
  if (data.length === 0) return false;
  // LibraryEntry never has 'year'. Movie[] always does.
  return 'year' in (data[0] as object);
}

// --- Migration helpers ---

export function migrateToEntries(movies: Movie[]): LibraryEntry[] {
  return movies.map((m) => ({
    id: crypto.randomUUID(),
    title: m.title,
    imdbId: m.imdbId,
    commonSenseAge: m.commonSenseAge,
    commonSenseScore: m.commonSenseScore,
    watched: m.watched,
    dateWatched: m.dateWatched,
    notes: m.notes,
    wishlistOrder: m.wishlistOrder,
    favorite: m.favorite ?? false,
  }));
}

export function buildNewCandidates(
  movies: Movie[],
  existing: Candidate[],
): Candidate[] {
  const byImdbId = new Set(existing.map((c) => c.imdbId).filter(Boolean));
  const byTitle = new Set(existing.map((c) => c.title.toLowerCase()));
  const now = new Date().toISOString();
  return movies
    .filter(
      (m) =>
        !(m.imdbId && byImdbId.has(m.imdbId)) &&
        !byTitle.has(m.title.toLowerCase()),
    )
    .map(
      (m): Candidate => ({
        title: m.title,
        displayTitle: m.displayTitle ?? null,
        year: m.year,
        imdbId: m.imdbId,
        imdb: m.imdb,
        rottenTomatoes: m.rottenTomatoes,
        commonSenseAge: m.commonSenseAge,
        studio: m.production ?? null,
        awards: m.awards ?? null,
        poster: m.poster ?? null,
        addedAt: now,
        directors: m.directors ?? null,
        writers: m.writers ?? null,
        omdbRefreshedAt: m.omdbRefreshedAt ?? null,
      }),
    );
}

// --- Join: prefer imdbId, fallback to title ---

export function findCandidate(
  candidates: Candidate[],
  entry: Pick<LibraryEntry, 'title' | 'imdbId'>,
): Candidate | undefined {
  // When duplicates exist (e.g. a merge survivor + its soft-removed twin share
  // an imdbId or title), prefer the active row so the library movie surfaces
  // the enriched survivor rather than the removed copy. Fall back to any match
  // so a movie whose only candidate is soft-removed still stays linked.
  if (entry.imdbId) {
    const byId = candidates.filter((c) => c.imdbId === entry.imdbId);
    if (byId.length > 0) {
      return byId.find((c) => c.removedAt == null) ?? byId[0];
    }
  }
  const lower = entry.title.toLowerCase();
  const byTitle = candidates.filter((c) => c.title.toLowerCase() === lower);
  return byTitle.find((c) => c.removedAt == null) ?? byTitle[0];
}

// --- Merge LibraryEntry + Candidate → Movie ---

export function mergeEntry(
  entry: LibraryEntry,
  candidate: Candidate | undefined,
): Movie {
  return {
    id: entry.id,
    title: entry.title,
    // Prefer the entry's own imdbId, but fall back to the matched Candidate's.
    // Seed / older library entries were stored with imdbId: null even though
    // their Candidate is linked (matched by title in findCandidate). Surfacing
    // the Candidate's id here makes the merged Movie reflect the real link, so
    // imdbId-gated features work on Watched / Up Next the same as on For You:
    // the "Where to watch" streaming auto-fetch, the Linked badge, OMDB refresh,
    // and the poster backfill. Without this, those movies looked unlinked and
    // never resolved streaming on their detail page.
    imdbId: entry.imdbId ?? candidate?.imdbId ?? null,
    displayTitle: candidate?.displayTitle ?? null,
    // commonSenseAge lives on Candidate (editable in Manage pool) but
    // can also be set per-family on LibraryEntry. Prefer the per-family
    // override when present so a family can correct the pool value
    // without affecting other families; fall back to the pool so a
    // freshly-added entry with no override still shows the badge.
    commonSenseAge: entry.commonSenseAge ?? candidate?.commonSenseAge ?? null,
    commonSenseScore: entry.commonSenseScore,
    watched: entry.watched,
    dateWatched: entry.dateWatched,
    notes: entry.notes,
    wishlistOrder: entry.wishlistOrder,
    favorite: entry.favorite ?? false,
    year: candidate?.year ?? null,
    poster: candidate?.poster ?? null,
    omdbRefreshedAt: candidate?.omdbRefreshedAt ?? null,
    imdb: candidate?.imdb ?? null,
    rottenTomatoes: candidate?.rottenTomatoes ?? null,
    rottenTomatoesId: candidate?.rottenTomatoesId ?? null,
    awards: candidate?.awards ?? null,
    production: candidate?.studio ?? null,
    directors: candidate?.directors ?? null,
    writers: candidate?.writers ?? null,
    streaming: candidate?.streaming ?? null,
  };
}

// --- Field routing: Movie → LibraryEntry / Candidate ---

export function toEntry(m: Movie): LibraryEntry {
  return {
    id: m.id ?? crypto.randomUUID(),
    title: m.title,
    imdbId: m.imdbId,
    commonSenseAge: m.commonSenseAge,
    commonSenseScore: m.commonSenseScore,
    watched: m.watched,
    dateWatched: m.dateWatched,
    notes: m.notes,
    wishlistOrder: m.wishlistOrder,
    favorite: m.favorite,
  };
}

export function toCandidate(m: Movie, existing: Candidate): Candidate {
  return {
    ...existing,
    title: m.title,
    displayTitle: m.displayTitle ?? null,
    imdbId: m.imdbId,
    year: m.year,
    poster: m.poster,
    omdbRefreshedAt: m.omdbRefreshedAt,
    imdb: m.imdb,
    rottenTomatoes: m.rottenTomatoes,
    awards: m.awards,
    studio: m.production,
    directors: m.directors,
    writers: m.writers,
    streaming: m.streaming ?? null,
  };
}

// Backfill stable ids for entries that predate the `id` field. Returns the
// (possibly) updated array plus whether anything changed, so the caller can
// persist exactly once.
function ensureEntryIds(entries: LibraryEntry[]): {
  entries: LibraryEntry[];
  changed: boolean;
} {
  let changed = false;
  const next = entries.map((e) => {
    if (e.id) return e;
    changed = true;
    return { ...e, id: crypto.randomUUID() };
  });
  return { entries: next, changed };
}

/**
 * Keeps the library (user overlay data) in sync with the per-family
 * `(family_id, kind='library')` row in Supabase, and merges with the
 * global pool Candidates (`family_id IS NULL, kind='pool'`) at render
 * time to produce Movie[].
 *
 * In local mode (no Supabase) — or when `familyId` is null because the
 * caller doesn't yet have a family scope — falls back to the bundled
 * movies.json SEED as Movie[] directly.
 */
export function useMovies({
  familyId,
  candidates,
  onUpdateCandidate,
  onAppendCandidates,
}: {
  familyId: string | null;
  candidates: Candidate[];
  onUpdateCandidate: (originalTitle: string, updated: Candidate) => Promise<void>;
  onAppendCandidates: (next: Candidate[]) => Promise<unknown>;
}): MoviesApi {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [status, setStatus] = useState<SyncStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );
  const [reloadTick, setReloadTick] = useState(0);
  const latestRef = useRef<LibraryEntry[]>([]);
  latestRef.current = entries;

  // Stable refs for use inside async callbacks to avoid stale closures.
  const candidatesRef = useRef<Candidate[]>(candidates);
  candidatesRef.current = candidates;
  const onUpdateCandidateRef = useRef(onUpdateCandidate);
  onUpdateCandidateRef.current = onUpdateCandidate;
  const onAppendCandidatesRef = useRef(onAppendCandidates);
  onAppendCandidatesRef.current = onAppendCandidates;

  useEffect(() => {
    if (!supabase || !familyId) return;
    let cancelled = false;
    setStatus('loading');

    async function load() {
      if (!supabase || !familyId) return;
      const { data, error } = await supabase
        .from(MOVIE_NIGHT_TABLE)
        .select('movies')
        .eq('family_id', familyId)
        .eq('kind', 'library')
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('[useMovies] load failed', error);
        setStatus('error');
        return;
      }

      const stored = (data?.movies ?? null) as unknown[] | null;

      if (!stored || stored.length === 0) {
        // Empty library row — happens for a freshly-created family. The
        // row itself is created by the create_family RPC (PR 5), so we
        // don't need to seed it here.
        setEntries([]);
        setStatus('synced');
        return;
      }

      if (isOldMovieFormat(stored)) {
        // Legacy migration: split flat Movie[] into LibraryEntry[] + new
        // Candidates. Predates multi-family; only triggers for the
        // Johnsons' library if it was somehow rolled back to the old
        // format. Coerces legacy director/writer strings into arrays as
        // we go so the pool rows written below already use the new shape.
        const old = (stored as unknown[]).map(coerceCreatorLists) as Movie[];
        const newEntries = migrateToEntries(old);
        const newCandidates = buildNewCandidates(
          old,
          candidatesRef.current,
        );
        const { error: writeError } = await supabase
          .from(MOVIE_NIGHT_TABLE)
          .update({ movies: newEntries })
          .eq('family_id', familyId)
          .eq('kind', 'library');
        if (cancelled) return;
        if (writeError) {
          console.error('[useMovies] migration write failed', writeError);
          setStatus('error');
          return;
        }
        setEntries(newEntries);
        latestRef.current = newEntries;
        if (newCandidates.length > 0) {
          await onAppendCandidatesRef.current(newCandidates);
        }
        setStatus('synced');
        return;
      }

      // Normal post-migration path: stored is LibraryEntry[]. Backfill any
      // rows missing a stable id (older data predates the field) and persist
      // once so mutations and React keys have a durable identity.
      const backfilled = ensureEntryIds(stored as LibraryEntry[]);
      setEntries(backfilled.entries);
      latestRef.current = backfilled.entries;
      if (backfilled.changed) {
        await supabase
          .from(MOVIE_NIGHT_TABLE)
          .update({ movies: backfilled.entries })
          .eq('family_id', familyId)
          .eq('kind', 'library');
      }
      setStatus('synced');
    }

    load();

    // Realtime filters only support a single column comparison, so we
    // narrow on family_id (high selectivity) and validate kind in the
    // callback. Channel name is per-family so concurrent multi-family
    // viewers don't cross-stream.
    const channel = supabase
      .channel(`library_updates_${familyId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: MOVIE_NIGHT_TABLE,
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          const row = payload.new as {
            kind?: string;
            movies?: LibraryEntry[];
          } | null;
          if (!row || row.kind !== 'library') return;
          const next = row.movies;
          if (Array.isArray(next)) {
            setEntries(next);
            latestRef.current = next;
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, [reloadTick, familyId]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // Derive Movie[] by merging LibraryEntry[] with Candidate[] from pool.
  // In local mode (no Supabase), return SEED directly as Movie[].
  const movies = useMemo(() => {
    if (!isSupabaseConfigured) return SEED;
    return entries.map((e) =>
      mergeEntry(e, findCandidate(candidates, e)),
    );
  }, [entries, candidates]);

  const writeRemote = useCallback(async (next: LibraryEntry[]) => {
    if (!supabase || !familyId) return;
    const { error } = await supabase
      .from(MOVIE_NIGHT_TABLE)
      .update({ movies: next })
      .eq('family_id', familyId)
      .eq('kind', 'library');
    if (error) {
      console.error('[useMovies] write failed', error);
      setStatus('error');
    } else {
      setStatus('synced');
    }
  }, [familyId]);

  const updateMovie = useCallback(
    async (originalTitle: string, updated: Movie) => {
      // Match by stable id so an edit targets the right row even when two
      // movies share a title; fall back to title for a not-yet-id'd template.
      const matches = (e: LibraryEntry) =>
        updated.id != null ? e.id === updated.id : e.title === originalTitle;
      // Capture old entry BEFORE mutation — needed for candidate lookup key.
      const oldEntry = latestRef.current.find(matches);
      const newEntry = toEntry(updated);
      const next = latestRef.current.map((e) => (matches(e) ? newEntry : e));
      setEntries(next);
      latestRef.current = next;
      await writeRemote(next);
      // Route metadata fields to matching Candidate in pool.
      if (oldEntry) {
        const existing = findCandidate(candidatesRef.current, oldEntry);
        if (existing) {
          await onUpdateCandidateRef.current(
            existing.title,
            toCandidate(updated, existing),
          );
        }
      }
    },
    [writeRemote],
  );

  const addMovie = useCallback(
    async (movie: Movie) => {
      const newEntry = toEntry(movie);
      const next = [...latestRef.current, newEntry];
      setEntries(next);
      latestRef.current = next;
      await writeRemote(next);
      // Seed a Candidate if no matching one exists in the pool.
      const existing = findCandidate(candidatesRef.current, newEntry);
      if (!existing) {
        await onAppendCandidatesRef.current([
          {
            title: movie.title,
            displayTitle: movie.displayTitle ?? null,
            year: movie.year,
            imdbId: movie.imdbId,
            imdb: movie.imdb,
            rottenTomatoes: movie.rottenTomatoes,
            commonSenseAge: movie.commonSenseAge,
            studio: movie.production,
            awards: movie.awards,
            poster: movie.poster,
            addedAt: new Date().toISOString(),
            directors: movie.directors,
            writers: movie.writers,
            omdbRefreshedAt: movie.omdbRefreshedAt,
          },
        ]);
      }
    },
    [writeRemote],
  );

  const deleteMovie = useCallback(
    async (id: string) => {
      // Only removes the LibraryEntry. The Candidate stays in the pool
      // so the movie can be re-recommended or manually re-added later.
      const next = latestRef.current.filter((e) => e.id !== id);
      setEntries(next);
      latestRef.current = next;
      await writeRemote(next);
    },
    [writeRemote],
  );

  const reorderWishlist = useCallback(
    async (orderedTitles: string[]) => {
      const orderByTitle = new Map<string, number>();
      orderedTitles.forEach((t, i) => orderByTitle.set(t, i));
      const next = latestRef.current.map((e) => {
        const nextOrder = orderByTitle.get(e.title);
        if (nextOrder == null) return e;
        return { ...e, wishlistOrder: nextOrder };
      });
      setEntries(next);
      latestRef.current = next;
      await writeRemote(next);
    },
    [writeRemote],
  );

  return {
    movies,
    status,
    updateMovie,
    addMovie,
    deleteMovie,
    reorderWishlist,
    reload,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import seed from '../movies.json';
import { coerceCreatorLists } from './format';
import type { Candidate, LibraryEntry, Movie } from './types';
import {
  isSupabaseConfigured,
  supabase,
  MOVIE_NIGHT_TABLE,
  MOVIE_NIGHT_ROW_ID,
} from './supabase';

const SEED: Movie[] = (seed as unknown[]).map(coerceCreatorLists) as Movie[];

export type SyncStatus = 'local' | 'loading' | 'synced' | 'error';

export type MoviesApi = {
  movies: Movie[];
  status: SyncStatus;
  updateMovie: (originalTitle: string, updated: Movie) => Promise<void>;
  addMovie: (movie: Movie) => Promise<void>;
  deleteMovie: (title: string) => Promise<void>;
  reorderWishlist: (orderedTitles: string[]) => Promise<void>;
  reload: () => void;
};

// --- Migration detection ---

function isOldMovieFormat(data: unknown[]): boolean {
  if (data.length === 0) return false;
  // LibraryEntry never has 'year'. Movie[] always does.
  return 'year' in (data[0] as object);
}

// --- Migration helpers ---

function migrateToEntries(movies: Movie[]): LibraryEntry[] {
  return movies.map((m) => ({
    title: m.title,
    imdbId: m.imdbId,
    displayTitle: m.displayTitle,
    commonSenseAge: m.commonSenseAge,
    commonSenseScore: m.commonSenseScore,
    watched: m.watched,
    dateWatched: m.dateWatched,
    notes: m.notes,
    wishlistOrder: m.wishlistOrder,
  }));
}

function buildNewCandidates(
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

function findCandidate(
  candidates: Candidate[],
  entry: Pick<LibraryEntry, 'title' | 'imdbId'>,
): Candidate | undefined {
  if (entry.imdbId) {
    const byId = candidates.find((c) => c.imdbId === entry.imdbId);
    if (byId) return byId;
  }
  return candidates.find(
    (c) => c.title.toLowerCase() === entry.title.toLowerCase(),
  );
}

// --- Merge LibraryEntry + Candidate → Movie ---

function mergeEntry(
  entry: LibraryEntry,
  candidate: Candidate | undefined,
): Movie {
  return {
    title: entry.title,
    imdbId: entry.imdbId,
    displayTitle: entry.displayTitle,
    commonSenseAge: entry.commonSenseAge,
    commonSenseScore: entry.commonSenseScore,
    watched: entry.watched,
    dateWatched: entry.dateWatched,
    notes: entry.notes,
    wishlistOrder: entry.wishlistOrder,
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
  };
}

// --- Field routing: Movie → LibraryEntry / Candidate ---

function toEntry(m: Movie): LibraryEntry {
  return {
    title: m.title,
    imdbId: m.imdbId,
    displayTitle: m.displayTitle,
    commonSenseAge: m.commonSenseAge,
    commonSenseScore: m.commonSenseScore,
    watched: m.watched,
    dateWatched: m.dateWatched,
    notes: m.notes,
    wishlistOrder: m.wishlistOrder,
  };
}

function toCandidate(m: Movie, existing: Candidate): Candidate {
  return {
    ...existing,
    title: m.title,
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
  };
}

/**
 * Keeps the library (user overlay data) in sync with row id=1 in Supabase,
 * and merges with pool Candidates (row id=2) at render time to produce Movie[].
 *
 * On first load with old flat Movie[] format in row id=1, transparently migrates:
 * splits into LibraryEntry[] (row id=1) and seeds pool (row id=2) with any
 * library movies not already present as Candidates.
 *
 * In local mode (no Supabase), falls back to movies.json SEED as Movie[] directly.
 */
export function useMovies({
  candidates,
  onUpdateCandidate,
  onAppendCandidates,
}: {
  candidates: Candidate[];
  onUpdateCandidate: (originalTitle: string, updated: Candidate) => Promise<void>;
  onAppendCandidates: (next: Candidate[]) => Promise<void>;
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
    if (!supabase) return;
    let cancelled = false;
    setStatus('loading');

    async function load() {
      if (!supabase) return;
      const { data, error } = await supabase
        .from(MOVIE_NIGHT_TABLE)
        .select('movies')
        .eq('id', MOVIE_NIGHT_ROW_ID)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('[useMovies] load failed', error);
        setStatus('error');
        return;
      }

      const stored = (data?.movies ?? null) as unknown[] | null;

      if (!stored || stored.length === 0) {
        if (!stored) {
          // Row missing entirely — create it with empty LibraryEntry[].
          const { error: seedError } = await supabase
            .from(MOVIE_NIGHT_TABLE)
            .upsert({ id: MOVIE_NIGHT_ROW_ID, movies: [] });
          if (cancelled) return;
          if (seedError) {
            console.error('[useMovies] seed failed', seedError);
            setStatus('error');
            return;
          }
        }
        setEntries([]);
        setStatus('synced');
        return;
      }

      if (isOldMovieFormat(stored)) {
        // Migration: split flat Movie[] into LibraryEntry[] + new Candidates.
        // Coerce legacy director/writer strings into arrays as we go so the
        // pool rows written below already use the new shape.
        const old = (stored as unknown[]).map(coerceCreatorLists) as Movie[];
        const newEntries = migrateToEntries(old);
        const newCandidates = buildNewCandidates(
          old,
          candidatesRef.current,
        );
        const { error: writeError } = await supabase
          .from(MOVIE_NIGHT_TABLE)
          .update({ movies: newEntries })
          .eq('id', MOVIE_NIGHT_ROW_ID);
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

      // Normal post-migration path: stored is LibraryEntry[].
      setEntries(stored as LibraryEntry[]);
      setStatus('synced');
    }

    load();

    const channel = supabase
      .channel('movie_night_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: MOVIE_NIGHT_TABLE,
          filter: `id=eq.${MOVIE_NIGHT_ROW_ID}`,
        },
        (payload) => {
          const next = (payload.new as { movies: LibraryEntry[] }).movies;
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
  }, [reloadTick]);

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
    if (!supabase) return;
    const { error } = await supabase
      .from(MOVIE_NIGHT_TABLE)
      .update({ movies: next })
      .eq('id', MOVIE_NIGHT_ROW_ID);
    if (error) {
      console.error('[useMovies] write failed', error);
      setStatus('error');
    } else {
      setStatus('synced');
    }
  }, []);

  const updateMovie = useCallback(
    async (originalTitle: string, updated: Movie) => {
      // Capture old entry BEFORE mutation — needed for candidate lookup key.
      const oldEntry = latestRef.current.find((e) => e.title === originalTitle);
      const newEntry = toEntry(updated);
      const next = latestRef.current.map((e) =>
        e.title === originalTitle ? newEntry : e,
      );
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
    async (title: string) => {
      // Only removes the LibraryEntry. The Candidate stays in the pool
      // so the movie can be re-recommended or manually re-added later.
      const next = latestRef.current.filter((e) => e.title !== title);
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

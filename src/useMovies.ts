import { useCallback, useEffect, useRef, useState } from 'react';
import seed from '../movies.json';
import type { Movie } from './types';
import {
  isSupabaseConfigured,
  supabase,
  MOVIE_NIGHT_TABLE,
  MOVIE_NIGHT_ROW_ID,
} from './supabase';

const SEED: Movie[] = seed as Movie[];

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

/**
 * Keeps the movie list in sync with a single row in Supabase. When Supabase
 * env vars aren't configured, falls back to in-memory state seeded from the
 * bundled movies.json — this lets the app render during first-time setup.
 *
 * Conflict model: whole-array last-write-wins. For two users editing at the
 * same instant the later write overwrites the earlier one; in practice this
 * is fine for a family movie night app where edits happen seconds apart at
 * most.
 */
export function useMovies(): MoviesApi {
  const [movies, setMovies] = useState<Movie[]>(SEED);
  const [status, setStatus] = useState<SyncStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );
  const [reloadTick, setReloadTick] = useState(0);
  // We always use the *latest* local state when writing, so we hold it in
  // a ref to avoid stale closures inside async callbacks.
  const latestRef = useRef<Movie[]>(SEED);
  latestRef.current = movies;

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

      const stored = (data?.movies ?? null) as Movie[] | null;

      if (!stored || stored.length === 0) {
        // Empty or missing row — seed with the bundled movies.json so the
        // first person to load the app initializes the shared state.
        const { error: seedError } = await supabase
          .from(MOVIE_NIGHT_TABLE)
          .upsert({ id: MOVIE_NIGHT_ROW_ID, movies: SEED });
        if (cancelled) return;
        if (seedError) {
          console.error('[useMovies] seed failed', seedError);
          setStatus('error');
          return;
        }
        setMovies(SEED);
      } else {
        setMovies(stored);
      }
      setStatus('synced');
    }

    load();

    // Subscribe to updates on our one row. When the other user writes, we
    // receive the new row payload and update local state directly.
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
          const next = (payload.new as { movies: Movie[] }).movies;
          if (Array.isArray(next)) setMovies(next);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, [reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  const writeRemote = useCallback(async (next: Movie[]) => {
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
      const next = latestRef.current.map((m) =>
        m.title === originalTitle ? updated : m,
      );
      setMovies(next);
      await writeRemote(next);
    },
    [writeRemote],
  );

  const addMovie = useCallback(
    async (movie: Movie) => {
      const next = [...latestRef.current, movie];
      setMovies(next);
      await writeRemote(next);
    },
    [writeRemote],
  );

  const deleteMovie = useCallback(
    async (title: string) => {
      const next = latestRef.current.filter((m) => m.title !== title);
      setMovies(next);
      await writeRemote(next);
    },
    [writeRemote],
  );

  // Assign wishlistOrder based on the supplied title sequence: the first
  // title gets order 0, the next 1, and so on. Titles missing from
  // `orderedTitles` keep their existing wishlistOrder — this lets the
  // caller pass just the currently displayed rows (e.g. search results)
  // without clobbering orders of hidden wishlist items.
  const reorderWishlist = useCallback(
    async (orderedTitles: string[]) => {
      const orderByTitle = new Map<string, number>();
      orderedTitles.forEach((t, i) => orderByTitle.set(t, i));
      const next = latestRef.current.map((m) => {
        const nextOrder = orderByTitle.get(m.title);
        if (nextOrder == null) return m;
        return { ...m, wishlistOrder: nextOrder };
      });
      setMovies(next);
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

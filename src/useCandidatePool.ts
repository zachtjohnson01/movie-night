import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candidate } from './types';
import {
  CANDIDATE_POOL_ROW_ID,
  MOVIE_NIGHT_TABLE,
  isSupabaseConfigured,
  supabase,
} from './supabase';

export type PoolStatus = 'local' | 'loading' | 'empty' | 'synced' | 'error';

export type CandidatePoolApi = {
  candidates: Candidate[];
  status: PoolStatus;
  appendCandidates: (next: Candidate[]) => Promise<void>;
};

/**
 * Loads and subscribes to the candidate pool (row id=2 in `movie_night`).
 * Mirrors the shape of `useMovies` so it slots into the same mental model.
 * Returns `status === 'empty'` when Supabase is configured but the pool
 * row doesn't exist or is empty — the For You screen uses that to show
 * the "Seed pool" button instead of blank content.
 */
export function useCandidatePool(): CandidatePoolApi {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState<PoolStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );
  const latestRef = useRef<Candidate[]>([]);
  latestRef.current = candidates;

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function load() {
      if (!supabase) return;
      const { data, error } = await supabase
        .from(MOVIE_NIGHT_TABLE)
        .select('movies')
        .eq('id', CANDIDATE_POOL_ROW_ID)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('[useCandidatePool] load failed', error);
        setStatus('error');
        return;
      }

      const stored = (data?.movies ?? null) as Candidate[] | null;
      if (!stored || stored.length === 0) {
        setCandidates([]);
        setStatus('empty');
      } else {
        setCandidates(stored);
        setStatus('synced');
      }
    }

    load();

    const channel = supabase
      .channel('candidate_pool_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: MOVIE_NIGHT_TABLE,
          filter: `id=eq.${CANDIDATE_POOL_ROW_ID}`,
        },
        (payload) => {
          const next = (payload.new as { movies?: Candidate[] } | null)?.movies;
          if (Array.isArray(next)) {
            setCandidates(next);
            setStatus(next.length === 0 ? 'empty' : 'synced');
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, []);

  const appendCandidates = useCallback(async (next: Candidate[]) => {
    if (!supabase || next.length === 0) return;
    // Dedupe against what's already in the pool, case-insensitive by title.
    const existingTitles = new Set(
      latestRef.current.map((c) => c.title.toLowerCase()),
    );
    const fresh = next.filter(
      (c) => !existingTitles.has(c.title.toLowerCase()),
    );
    if (fresh.length === 0) return;

    const merged = [...latestRef.current, ...fresh];
    setCandidates(merged);
    setStatus('synced');

    // upsert handles the first-ever write (when row id=2 doesn't exist yet)
    // and subsequent updates in the same call. The existing permissive
    // INSERT + UPDATE RLS policies on `movie_night` cover both paths.
    const { error } = await supabase
      .from(MOVIE_NIGHT_TABLE)
      .upsert({ id: CANDIDATE_POOL_ROW_ID, movies: merged });
    if (error) {
      console.error('[useCandidatePool] append failed', error);
      setStatus('error');
    }
  }, []);

  return { candidates, status, appendCandidates };
}

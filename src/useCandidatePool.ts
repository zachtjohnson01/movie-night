import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candidate } from './types';
import {
  CANDIDATE_POOL_ROW_ID,
  MOVIE_NIGHT_TABLE,
  REMOVAL_REASONS_ROW_ID,
  SCORING_WEIGHTS_ROW_ID,
  isSupabaseConfigured,
  supabase,
} from './supabase';
import { DEFAULT_WEIGHTS, type ScoringWeights } from './scoring';
import { getMovieById } from './omdb';
import { coerceCreatorLists } from './format';

export type PoolStatus = 'local' | 'loading' | 'empty' | 'synced' | 'error';

export type CandidatePoolApi = {
  candidates: Candidate[];
  status: PoolStatus;
  reasons: string[];
  weights: ScoringWeights;
  appendCandidates: (next: Candidate[]) => Promise<void>;
  updateCandidate: (originalTitle: string, updated: Candidate) => Promise<void>;
  replaceCandidates: (next: Candidate[]) => Promise<void>;
  toggleDownvote: (title: string) => Promise<void>;
  removeCandidate: (title: string, reason: string) => Promise<void>;
  restoreCandidate: (title: string) => Promise<void>;
  reload: () => void;
  bulkRefreshOmdb: (
    onProgress: (done: number, total: number) => void,
    cancelSignal?: { cancelled: boolean },
  ) => Promise<{ updated: number; skipped: number; failed: number }>;
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
  const [reasons, setReasons] = useState<string[]>([]);
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [status, setStatus] = useState<PoolStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );
  const [reloadTick, setReloadTick] = useState(0);
  const latestRef = useRef<Candidate[]>([]);
  latestRef.current = candidates;
  const reasonsRef = useRef<string[]>([]);
  reasonsRef.current = reasons;

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setStatus('loading');

    async function load() {
      if (!supabase) return;
      const [poolRes, reasonsRes, weightsRes] = await Promise.all([
        supabase
          .from(MOVIE_NIGHT_TABLE)
          .select('movies')
          .eq('id', CANDIDATE_POOL_ROW_ID)
          .maybeSingle(),
        supabase
          .from(MOVIE_NIGHT_TABLE)
          .select('movies')
          .eq('id', REMOVAL_REASONS_ROW_ID)
          .maybeSingle(),
        supabase
          .from(MOVIE_NIGHT_TABLE)
          .select('movies')
          .eq('id', SCORING_WEIGHTS_ROW_ID)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (poolRes.error) {
        console.error('[useCandidatePool] load failed', poolRes.error);
        setStatus('error');
        return;
      }

      const storedRaw = (poolRes.data?.movies ?? null) as unknown[] | null;
      if (!storedRaw || storedRaw.length === 0) {
        setCandidates([]);
        setStatus('empty');
      } else {
        // Coerce legacy `director`/`writer` string fields into the new
        // `directors`/`writers` arrays on the way in, so the rest of the
        // app only deals with the array shape.
        const stored = storedRaw.map(
          (c) => coerceCreatorLists(c as object) as Candidate,
        );
        setCandidates(stored);
        setStatus('synced');
      }

      // Reason vocabulary load — a missing row or read error is non-fatal:
      // the pool UI still works, there just aren't any suggested checkboxes
      // until the admin types the first reason.
      if (reasonsRes.error) {
        console.error(
          '[useCandidatePool] reasons load failed',
          reasonsRes.error,
        );
        setReasons([]);
      } else {
        const raw = (reasonsRes.data?.movies ?? null) as string[] | null;
        setReasons(Array.isArray(raw) ? raw : []);
      }

      // Scoring weights — non-fatal; falls back to DEFAULT_WEIGHTS.
      if (!weightsRes.error && weightsRes.data?.movies) {
        const raw = weightsRes.data.movies as Partial<ScoringWeights>;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          setWeights({ ...DEFAULT_WEIGHTS, ...raw });
        }
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
          const next = (payload.new as { movies?: unknown[] } | null)?.movies;
          if (Array.isArray(next)) {
            const coerced = next.map(
              (c) => coerceCreatorLists(c as object) as Candidate,
            );
            setCandidates(coerced);
            setStatus(coerced.length === 0 ? 'empty' : 'synced');
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: MOVIE_NIGHT_TABLE,
          filter: `id=eq.${REMOVAL_REASONS_ROW_ID}`,
        },
        (payload) => {
          const next = (payload.new as { movies?: string[] } | null)?.movies;
          if (Array.isArray(next)) setReasons(next);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, [reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

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

  const writePool = useCallback(async (next: Candidate[]) => {
    if (!supabase) return;
    setCandidates(next);
    setStatus(next.length === 0 ? 'empty' : 'synced');
    const { error } = await supabase
      .from(MOVIE_NIGHT_TABLE)
      .upsert({ id: CANDIDATE_POOL_ROW_ID, movies: next });
    if (error) {
      console.error('[useCandidatePool] write failed', error);
      setStatus('error');
    }
  }, []);

  const updateCandidate = useCallback(
    async (originalTitle: string, updated: Candidate) => {
      const current = latestRef.current;
      const idx = current.findIndex((c) => c.title === originalTitle);
      if (idx === -1) return;
      const next = [...current];
      next[idx] = updated;
      await writePool(next);
    },
    [writePool],
  );

  const toggleDownvote = useCallback(
    async (title: string) => {
      const current = latestRef.current;
      const idx = current.findIndex((c) => c.title === title);
      if (idx === -1) return;
      const next = [...current];
      next[idx] = { ...next[idx], downvoted: !next[idx].downvoted };
      await writePool(next);
    },
    [writePool],
  );

  // Appends a reason to the row-3 vocabulary if it isn't already present.
  // Case-insensitive match so "Duplicate" and "duplicate" don't double up.
  const ensureReasonStored = useCallback(async (reason: string) => {
    if (!supabase) return;
    const trimmed = reason.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (reasonsRef.current.some((r) => r.toLowerCase() === lower)) return;
    const nextReasons = [...reasonsRef.current, trimmed];
    setReasons(nextReasons);
    const { error } = await supabase
      .from(MOVIE_NIGHT_TABLE)
      .upsert({ id: REMOVAL_REASONS_ROW_ID, movies: nextReasons });
    if (error) console.error('[useCandidatePool] reason write failed', error);
  }, []);

  const removeCandidate = useCallback(
    async (title: string, reason: string) => {
      const trimmed = reason.trim();
      if (!trimmed) return;
      const current = latestRef.current;
      const idx = current.findIndex((c) => c.title === title);
      if (idx === -1) return;
      const next = [...current];
      next[idx] = {
        ...next[idx],
        removedReason: trimmed,
        removedAt: new Date().toISOString(),
      };
      // Persist the reason first so it's available as a checkbox
      // immediately after the row write lands in realtime.
      await ensureReasonStored(trimmed);
      await writePool(next);
    },
    [writePool, ensureReasonStored],
  );

  const restoreCandidate = useCallback(
    async (title: string) => {
      const current = latestRef.current;
      const idx = current.findIndex((c) => c.title === title);
      if (idx === -1) return;
      const next = [...current];
      next[idx] = { ...next[idx], removedReason: null, removedAt: null };
      await writePool(next);
    },
    [writePool],
  );

  const bulkRefreshOmdb = useCallback(
    async (
      onProgress: (done: number, total: number) => void,
      cancelSignal?: { cancelled: boolean },
    ): Promise<{ updated: number; skipped: number; failed: number }> => {
      const linked = latestRef.current.filter((c) => c.imdbId != null);
      const total = linked.length;
      let updated = 0, skipped = 0, failed = 0;
      const next = [...latestRef.current];

      for (let i = 0; i < linked.length; i++) {
        if (cancelSignal?.cancelled) {
          onProgress(i, total);
          await writePool(next);
          return { updated, skipped, failed };
        }
        onProgress(i, total);
        const c = linked[i];
        try {
          const patch = await getMovieById(c.imdbId!);
          const idx = next.findIndex((x) => x.title === c.title);
          if (idx === -1) { skipped++; continue; }
          const prev = next[idx];
          const merged: Candidate = {
            ...prev,
            imdb: patch.imdb ?? prev.imdb,
            rottenTomatoes: patch.rottenTomatoes ?? prev.rottenTomatoes,
            poster: patch.poster ?? prev.poster,
            awards: patch.awards ?? prev.awards,
            studio: patch.production ?? prev.studio,
            directors: patch.directors ?? prev.directors,
            writers: patch.writers ?? prev.writers,
            year: patch.year ?? prev.year,
            type: patch.type ?? prev.type,
            omdbRefreshedAt: new Date().toISOString(),
          };
          const changed =
            !sameNameList(merged.directors, prev.directors) ||
            !sameNameList(merged.writers, prev.writers) ||
            merged.imdb !== prev.imdb ||
            merged.rottenTomatoes !== prev.rottenTomatoes ||
            merged.poster !== prev.poster;
          next[idx] = merged;
          if (changed) updated++; else skipped++;
        } catch { failed++; }
        await new Promise((r) => setTimeout(r, 150));
      }

      onProgress(total, total);
      await writePool(next);
      return { updated, skipped, failed };
    },
    [writePool],
  );

  return {
    candidates,
    status,
    reasons,
    weights,
    appendCandidates,
    updateCandidate,
    replaceCandidates: writePool,
    toggleDownvote,
    removeCandidate,
    restoreCandidate,
    reload,
    bulkRefreshOmdb,
  };
}

function sameNameList(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) {
    if (la[i] !== lb[i]) return false;
  }
  return true;
}

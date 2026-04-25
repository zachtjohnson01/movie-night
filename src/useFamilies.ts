import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase, MOVIE_NIGHT_TABLE } from './supabase';

export type FamilySummary = {
  id: string;
  slug: string;
  name: string;
  watchedCount: number;
  wishlistCount: number;
};

export type FamiliesStatus = 'loading' | 'synced' | 'error' | 'local';

export type FamiliesApi = {
  families: FamilySummary[];
  status: FamiliesStatus;
};

type FamilyRow = { id: string; slug: string; name: string };
type LibraryRow = { family_id: string | null; movies: unknown };

/**
 * Lists all families for the landing page, with watched + wishlist
 * counts derived from each family's library row. Two-query approach:
 * one fetch for `families`, one for the `library`-kind rows of
 * `movie_night`. Counts happen client-side because the JSONB blob
 * isn't queryable per-field.
 *
 * Snapshot-only — no realtime subscription. Counts go stale if the
 * other family edits, but the landing page is a directory, not a
 * live dashboard. Accept the staleness; it refreshes on next mount.
 */
export function useFamilies(): FamiliesApi {
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [status, setStatus] = useState<FamiliesStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setStatus('loading');

    async function load() {
      if (!supabase) return;
      const [familiesRes, librariesRes] = await Promise.all([
        supabase.from('families').select('id, slug, name').order('created_at'),
        supabase
          .from(MOVIE_NIGHT_TABLE)
          .select('family_id, movies')
          .eq('kind', 'library'),
      ]);
      if (cancelled) return;
      if (familiesRes.error) {
        console.error('[useFamilies] families load failed', familiesRes.error);
        setStatus('error');
        return;
      }
      if (librariesRes.error) {
        console.error(
          '[useFamilies] libraries load failed',
          librariesRes.error,
        );
        setStatus('error');
        return;
      }
      const rows = (familiesRes.data ?? []) as FamilyRow[];
      const libraries = (librariesRes.data ?? []) as LibraryRow[];
      const byFamily = new Map<string, unknown[]>();
      for (const lib of libraries) {
        if (!lib.family_id) continue;
        const movies = Array.isArray(lib.movies) ? lib.movies : [];
        byFamily.set(lib.family_id, movies);
      }
      const summaries: FamilySummary[] = rows.map((r) => {
        const movies = byFamily.get(r.id) ?? [];
        let watched = 0;
        let wishlist = 0;
        for (const m of movies) {
          if (m && typeof m === 'object' && 'watched' in m) {
            if ((m as { watched: unknown }).watched === true) watched += 1;
            else wishlist += 1;
          }
        }
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          watchedCount: watched,
          wishlistCount: wishlist,
        };
      });
      setFamilies(summaries);
      setStatus('synced');
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { families, status };
}

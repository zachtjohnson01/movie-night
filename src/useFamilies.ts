import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase, MOVIE_NIGHT_TABLE } from './supabase';

/**
 * Identifier pair we keep around for each family's most-recently-watched
 * library entries. The library blob (`LibraryEntry`) doesn't carry
 * posters — those live on the global `Candidate` pool. Landing pairs
 * these keys with `useCandidatePool().candidates` to render posters
 * without an extra fetch.
 */
export type FamilyRecentKey = {
  title: string;
  imdbId: string | null;
};

export type FamilySummary = {
  id: string;
  slug: string;
  name: string;
  watchedCount: number;
  wishlistCount: number;
  /**
   * Up to 9 most-recently-watched library entries, sorted by
   * `dateWatched` desc with `null`s last. Used by the landing page to
   * build a poster mosaic + per-card poster strips. Empty for families
   * with no watched movies.
   */
  recentWatched: FamilyRecentKey[];
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
        const watchedEntries: Array<{
          title: string;
          imdbId: string | null;
          dateWatched: string | null;
        }> = [];
        for (const m of movies) {
          if (!m || typeof m !== 'object' || !('watched' in m)) continue;
          const obj = m as {
            watched: unknown;
            title?: unknown;
            imdbId?: unknown;
            dateWatched?: unknown;
          };
          if (obj.watched === true) {
            watched += 1;
            if (typeof obj.title === 'string') {
              watchedEntries.push({
                title: obj.title,
                imdbId:
                  typeof obj.imdbId === 'string' && obj.imdbId
                    ? obj.imdbId
                    : null,
                dateWatched:
                  typeof obj.dateWatched === 'string' && obj.dateWatched
                    ? obj.dateWatched
                    : null,
              });
            }
          } else {
            wishlist += 1;
          }
        }
        // Sort by dateWatched desc, dated entries before undated. Take
        // the first 9 — enough for a 3x3 mosaic on the landing page,
        // and FamilyCard slices to 3 from the same array.
        watchedEntries.sort((a, b) => {
          if (a.dateWatched && b.dateWatched) {
            return a.dateWatched < b.dateWatched ? 1 : -1;
          }
          if (a.dateWatched) return -1;
          if (b.dateWatched) return 1;
          return 0;
        });
        const recentWatched: FamilyRecentKey[] = watchedEntries
          .slice(0, 9)
          .map((e) => ({ title: e.title, imdbId: e.imdbId }));
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          watchedCount: watched,
          wishlistCount: wishlist,
          recentWatched,
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

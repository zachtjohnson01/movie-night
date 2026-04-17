import type { Movie } from './types';

/**
 * Recommendations engine. Asks Claude (via the `/api/recommendations`
 * serverless function) for family-film recommendations grounded in the
 * watched list's attributes.
 *
 * Results ACCUMULATE in localStorage. "Add more" requests another batch
 * that doesn't overlap what we already have. Every batch is re-ranked
 * globally so the list stays cardinally ordered (best first).
 *
 * Ranking priority, in order:
 *   1. RT + IMDb ratings
 *   2. Common Sense Media age appropriateness
 *   3. Studio pedigree (Ghibli, Pixar, etc.)
 *   4. Major awards (Oscar, Annie, BAFTA, etc.)
 *   5. Notes / vibe match
 *   6. Tonal similarity (tiebreaker)
 */

const CACHE_KEY = 'fmn:recs:v1';
export const RECS_BATCH_SIZE = 10;

export type Recommendation = {
  title: string;
  year: number | null;
  commonSenseAge: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
  studio: string | null;
  awards: string | null;
  fitScore: number | null;
  why: string;
};

export type RecCache = {
  items: Recommendation[];
  generatedAt: number;
  lastAdded: string[];
  generations: number;
};

export type AddBatchResult = RecCache & {
  lastSurvived: number;
  lastRawCount: number;
};

function loadCache(): RecCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecCache;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: RecCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or disabled — soldier on, cache is best-effort.
  }
}

export function getCachedRecommendations(): RecCache | null {
  return loadCache();
}

export function clearRecommendations() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // noop
  }
}

/**
 * Ask the server for a fresh batch, dedup against the library + previous
 * recs, trim to RECS_BATCH_SIZE, merge with any cached recs, and globally
 * re-rank by fitScore (descending, stable for ties).
 */
export async function addRecommendationBatch(
  movies: Movie[],
): Promise<AddBatchResult> {
  const cached = loadCache() || {
    items: [],
    generatedAt: 0,
    lastAdded: [],
    generations: 0,
  };

  const existingRecTitles = cached.items.map((r) => r.title);

  const resp = await fetch('/api/recommendations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      movies: movies.map((m) => ({
        title: m.title,
        watched: m.watched,
        commonSenseAge: m.commonSenseAge,
        rottenTomatoes: m.rottenTomatoes,
        imdb: m.imdb,
        notes: m.notes,
      })),
      existingRecs: existingRecTitles,
      batchSize: RECS_BATCH_SIZE,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(detail.error || `HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    items: Recommendation[];
    rawCount: number;
  };
  const fresh = Array.isArray(data.items) ? data.items : [];

  // Build a lowercase ban set from everything already on the user's
  // radar so we reject duplicates even if the model slipped one through.
  const existingLower = new Set<string>();
  for (const m of movies) existingLower.add(m.title.toLowerCase());
  for (const t of existingRecTitles) existingLower.add(t.toLowerCase());

  const scored = fresh
    .filter((r) => !existingLower.has(r.title.toLowerCase()))
    .slice(0, RECS_BATCH_SIZE)
    .map((r, i) => ({
      ...r,
      fitScore:
        typeof r.fitScore === 'number' && !Number.isNaN(r.fitScore)
          ? r.fitScore
          : Math.max(60, 100 - i * 4),
    }));

  const merged = [...cached.items, ...scored]
    .map((r, i) => ({ rec: r, i }))
    .sort(
      (a, b) =>
        (b.rec.fitScore ?? 0) - (a.rec.fitScore ?? 0) || a.i - b.i,
    )
    .map(({ rec }) => rec);

  const out: AddBatchResult = {
    items: merged,
    generatedAt: Date.now(),
    generations: (cached.generations || 0) + 1,
    lastAdded: scored.map((r) => r.title),
    lastSurvived: scored.length,
    lastRawCount: data.rawCount ?? fresh.length,
  };

  saveCache({
    items: out.items,
    generatedAt: out.generatedAt,
    lastAdded: out.lastAdded,
    generations: out.generations,
  });

  return out;
}

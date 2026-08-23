import type { Movie } from './types';

/**
 * Taste profiling for pool expansion.
 *
 * The "For You" ranker (`scoring.ts`) is good at ordering candidates that are
 * *already in the pool*. It can't help with the upstream problem: getting
 * genuinely similar films **into** the pool in the first place. That's what
 * this module is for.
 *
 * Previously the expansion prompt got the library only as (a) a flat ban list
 * of titles and (b) an alphabetical dump of every director/writer/studio the
 * family had ever touched. Both signals are near-useless for similarity: the
 * ban list is framed as a negative, and an alphabetical list of ~80 names
 * doesn't tell the model which two directors the family actually loves.
 *
 * `buildTasteProfile` fixes that by turning the **watched** library into a
 * ranked, weighted profile: a handful of anchor titles ("find films like
 * these"), plus creator/studio lists ordered by how much the family demonstrably
 * likes them. All pure — no I/O, no clock — so it's fully testable and
 * deterministic.
 */

export type TasteAnchor = {
  title: string;
  year: number | null;
  studio: string | null;
  directors: string[];
  commonSenseAge: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
  favorite: boolean;
};

export type TasteProfile = {
  /** Seed titles the model is told to find neighbours of, best-loved first. */
  anchors: TasteAnchor[];
  /** Creators/studios ranked by demonstrated affinity, not alphabetically. */
  directors: string[];
  writers: string[];
  studios: string[];
  /** How many watched movies the profile was derived from (0 = fell back). */
  watchedCount: number;
};

// How much of the library to hand over. Anchors are the expensive part of the
// prompt (one line each with metadata) and attention degrades fast past a
// dozen, so keep the list short and high-signal. Creator lists are one word
// each, so they can run longer.
const MAX_ANCHORS = 12;
const MAX_DIRECTORS = 12;
const MAX_WRITERS = 10;
const MAX_STUDIOS = 8;

// A favourite is the single strongest "more like this" signal the app has —
// the user explicitly starred it. Set above the 0–100 rating range so a star
// strictly dominates any rating delta: every favourite outranks every
// unstarred film, and favourites then order among themselves by rating.
const FAVORITE_BONUS = 110;
// Neutral stand-in when a movie has no RT/IMDb at all, so unrated library rows
// sit mid-pack instead of sinking below everything (they're still watched
// films the family chose).
const NEUTRAL_RATING = 60;

/**
 * How strongly the family appears to like one watched movie: 0–100 from
 * ratings, plus a dominating bonus for an explicit favourite.
 * Ratings supply the base (a watched 95% film is a better neighbour seed than
 * a watched 40% one) and an explicit favourite star dominates.
 */
export function affinityScore(m: Movie): number {
  const signals: number[] = [];
  const rt = parsePercent(m.rottenTomatoes);
  if (rt != null) signals.push(rt);
  const imdb = parseRating(m.imdb);
  if (imdb != null) signals.push(imdb);
  const base = signals.length
    ? signals.reduce((s, n) => s + n, 0) / signals.length
    : NEUTRAL_RATING;
  return base + (m.favorite ? FAVORITE_BONUS : 0);
}

function parsePercent(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clamp(n, 0, 100) : null;
}

function parseRating(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? clamp(n * 10, 0, 100) : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t.toUpperCase() === 'N/A') return null;
  return t;
}

/**
 * Rank names by summed affinity of the movies they appear on, so a director
 * with two beloved films outranks one with a single mediocre credit. Ties
 * break on credit count, then alphabetically — keeps the output stable.
 */
function rankByAffinity(
  entries: Array<{ name: string; weight: number }>,
  limit: number,
): string[] {
  const totals = new Map<string, { name: string; weight: number; count: number }>();
  for (const { name, weight } of entries) {
    const key = name.toLowerCase();
    const prev = totals.get(key);
    if (prev) {
      prev.weight += weight;
      prev.count += 1;
    } else {
      totals.set(key, { name, weight, count: 1 });
    }
  }
  return [...totals.values()]
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((e) => e.name);
}

/**
 * Build the similarity profile that drives pool expansion.
 *
 * Sources it from **watched** movies only — the user's ask is "more like what
 * we've actually seen and liked", and a wishlist entry is an untested guess.
 * If nothing has been watched yet (a brand-new family) it falls back to the
 * whole library so expansion still has something to aim at.
 */
export function buildTasteProfile(movies: Movie[]): TasteProfile {
  const watchedMovies = movies.filter((m) => m.watched);
  const source = watchedMovies.length > 0 ? watchedMovies : movies;

  const scored = source
    .map((m, i) => ({ m, i, score: affinityScore(m) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Newer watch dates first among equals; ISO date strings compare
        // lexicographically, and nulls sort last.
        (b.m.dateWatched ?? '').localeCompare(a.m.dateWatched ?? '') ||
        a.i - b.i,
    );

  const anchors: TasteAnchor[] = scored.slice(0, MAX_ANCHORS).map(({ m }) => ({
    title: m.displayTitle?.trim() || m.title,
    year: m.year,
    studio: cleanName(m.production),
    // Two names is enough to identify the sensibility; a full six-writer
    // credit list just burns prompt budget.
    directors: (m.directors ?? []).map(cleanName).filter((n): n is string => !!n).slice(0, 2),
    commonSenseAge: m.commonSenseAge,
    rottenTomatoes: m.rottenTomatoes,
    imdb: m.imdb,
    favorite: m.favorite,
  }));

  const directorEntries: Array<{ name: string; weight: number }> = [];
  const writerEntries: Array<{ name: string; weight: number }> = [];
  const studioEntries: Array<{ name: string; weight: number }> = [];
  for (const { m, score } of scored) {
    for (const raw of m.directors ?? []) {
      const name = cleanName(raw);
      if (name) directorEntries.push({ name, weight: score });
    }
    for (const raw of m.writers ?? []) {
      const name = cleanName(raw);
      if (name) writerEntries.push({ name, weight: score });
    }
    const studio = cleanName(m.production);
    if (studio) studioEntries.push({ name: studio, weight: score });
  }

  return {
    anchors,
    directors: rankByAffinity(directorEntries, MAX_DIRECTORS),
    writers: rankByAffinity(writerEntries, MAX_WRITERS),
    studios: rankByAffinity(studioEntries, MAX_STUDIOS),
    watchedCount: watchedMovies.length,
  };
}

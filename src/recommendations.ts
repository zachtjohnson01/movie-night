import type { Candidate, Movie } from './types';
import { dedupKey, enrichCandidate, normalizeTitle } from './omdb';
import { DEFAULT_WEIGHTS, scoreCandidate, type ScoreContext, type ScoringWeights } from './scoring';
import { supabase } from './supabase';

/**
 * Deterministic top-picks engine. Consumes the candidate pool (persisted in
 * Supabase, fetched via useCandidatePool) and the user's library, returns
 * the top N candidates that aren't already on the user's list — ranked by
 * the pure `scoreCandidate` function. No LLM on the user path; same
 * inputs produce the same output every session.
 *
 * `expandPool` is the admin-only flow that grows the pool: asks Claude
 * for a fresh batch of titles, enriches each via OMDB for authoritative
 * RT / IMDb / Awards, and returns the merged Candidate[] ready to append.
 */

export type RankedPick = Candidate & { fitScore: number };

const DEFAULT_LIMIT = 20;

function buildLibrarySets(library: Movie[]) {
  return {
    imdbIds: new Set(library.map((m) => m.imdbId).filter((id): id is string => !!id)),
    titles: new Set(library.map((m) => normalizeTitle(m.title))),
  };
}

// Drop candidates with no rating signal — LLM stubs that slip through when
// OMDB enrichment fails. Also drop soft-removed rows (kept in the pool blob
// for the ban list) and titles already in the user's library.
function isEffective(c: Candidate, imdbIds: Set<string>, titles: Set<string>): boolean {
  return (
    (c.rottenTomatoes != null || c.imdb != null) &&
    c.removedReason == null &&
    !(c.imdbId && imdbIds.has(c.imdbId)) &&
    !titles.has(normalizeTitle(c.title))
  );
}

/**
 * Count eligible candidates — same criteria as PoolAdmin's "Eligible" chip so
 * the For You header matches what the admin screen shows.
 */
export function countEffectiveCandidates(candidates: Candidate[]): number {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const k = dedupKey(c.title);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dupKeys = new Set<string>();
  counts.forEach((n, k) => { if (n >= 2) dupKeys.add(k); });
  return candidates.filter(
    (c) =>
      c.imdbId != null &&
      !dupKeys.has(dedupKey(c.title)) &&
      (c.type == null || c.type === 'movie') &&
      c.removedAt == null &&
      (c.rottenTomatoes != null || c.imdb != null),
  ).length;
}

/**
 * Rank the candidate pool against the user's library. Pure function.
 */
export function rankTopPicks(
  candidates: Candidate[],
  library: Movie[],
  limit: number = DEFAULT_LIMIT,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): RankedPick[] {
  const { imdbIds, titles } = buildLibrarySets(library);
  const knownDirectors = extractUnique(library.map((m) => m.director));
  const knownWriters = extractUnique(library.map((m) => m.writer));
  const ctx: ScoreContext = { knownDirectors, knownWriters };
  const scored: RankedPick[] = candidates
    .filter((c) => isEffective(c, imdbIds, titles))
    .map((c) => ({ ...c, fitScore: scoreCandidate(c, ctx, weights) }));

  // Sort descending by score, stable on ties (preserve pool insertion order).
  return scored
    .map((pick, i) => ({ pick, i }))
    .sort((a, b) => b.pick.fitScore - a.pick.fitScore || a.i - b.i)
    .slice(0, limit)
    .map(({ pick }) => pick);
}

type RawCandidateFromApi = {
  title: string;
  year: number | null;
  commonSenseAge: string | null;
  studio: string | null;
  awards: string | null;
  director: string | null;
  writer: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
};

/**
 * Split comma-separated strings, trim, deduplicate, and drop blanks / "N/A".
 * Used to build director/writer/studio lists from library movies.
 */
export function extractUnique(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v) continue;
    for (const part of v.split(',')) {
      const s = part.trim();
      if (s && s !== 'N/A') seen.add(s);
    }
  }
  return [...seen].sort();
}

/**
 * Admin-only: request a fresh batch of candidate films from the LLM,
 * enrich each one via OMDB in parallel, and return a fully-formed
 * Candidate[] ready to append to the pool. Does NOT write to Supabase —
 * the caller does that through `useCandidatePool.appendCandidates`.
 */
export async function expandPool(
  poolTitles: string[],
  libraryTitles: string[],
  batchSize: number = 100,
  libraryContext?: { directors: string[]; writers: string[]; studios: string[] },
): Promise<Candidate[]> {
  // The endpoint verifies this JWT server-side and rejects anyone not on
  // the admin allowlist — without a live session we can't even try.
  if (!supabase) {
    throw new Error('Auth is not configured — cannot expand pool.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Sign in required to expand the pool.');
  }

  const resp = await fetch('/api/recommendations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      poolTitles,
      libraryTitles,
      batchSize,
      directors: libraryContext?.directors ?? [],
      writers: libraryContext?.writers ?? [],
      studios: libraryContext?.studios ?? [],
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    const base = body.error || `HTTP ${resp.status}`;
    throw new Error(body.detail ? `${base} — ${body.detail}` : base);
  }

  const data = (await resp.json()) as { items: RawCandidateFromApi[] };
  const raw = Array.isArray(data.items) ? data.items : [];
  if (raw.length === 0) return [];

  // OMDB calls in parallel. allSettled so one 404 doesn't nuke the batch.
  const enriched = await Promise.allSettled(
    raw.map((r) => enrichCandidate(r.title)),
  );

  const now = new Date().toISOString();
  // OMDB gates the pool: searchMovies is type-filtered to films, so a null
  // enrichment means OMDB couldn't confirm this title as a movie. Drop it
  // rather than let an LLM-hallucinated TV show slip in unlinked.
  const out: Candidate[] = raw.flatMap((r, i) => {
    const omdb =
      enriched[i].status === 'fulfilled' ? enriched[i].value : null;
    if (!omdb) return [];
    // Merge rules: OMDB wins for RT / IMDb / awards / year / poster / imdbId.
    // LLM wins for CSM age (OMDB has none) and studio (OMDB's Production
    // is usually "N/A" on the free tier).
    return [{
      title: r.title,
      year: omdb.year ?? r.year,
      imdbId: omdb.imdbId,
      imdb: omdb.imdb ?? r.imdb,
      rottenTomatoes: omdb.rottenTomatoes ?? r.rottenTomatoes,
      commonSenseAge: r.commonSenseAge,
      studio: r.studio ?? omdb.production ?? null,
      awards: omdb.awards ?? r.awards,
      director: omdb.director ?? r.director ?? null,
      writer: omdb.writer ?? r.writer ?? null,
      poster: omdb.poster ?? null,
      addedAt: now,
      type: omdb.type,
    }];
  });

  // Final client-side dedupe against pool + library.
  const ban = new Set<string>();
  for (const t of poolTitles) ban.add(t.toLowerCase());
  for (const t of libraryTitles) ban.add(t.toLowerCase());
  return out.filter((c) => !ban.has(c.title.toLowerCase()));
}

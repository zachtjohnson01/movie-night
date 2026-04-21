import type { Candidate, Movie } from './types';
import { enrichCandidate, normalizeTitle } from './omdb';
import { scoreCandidate } from './scoring';
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

/**
 * Rank the candidate pool against the user's library. Pure function.
 */
export function rankTopPicks(
  candidates: Candidate[],
  library: Movie[],
  limit: number = DEFAULT_LIMIT,
): RankedPick[] {
  const libraryImdbIds = new Set(
    library.map((m) => m.imdbId).filter((id): id is string => !!id),
  );
  const libraryTitles = new Set(library.map((m) => normalizeTitle(m.title)));
  const scored: RankedPick[] = candidates
    .filter(
      (c) =>
        !(c.imdbId && libraryImdbIds.has(c.imdbId)) &&
        !libraryTitles.has(normalizeTitle(c.title)),
    )
    .map((c) => ({ ...c, fitScore: scoreCandidate(c) }));

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
  rottenTomatoes: string | null;
  imdb: string | null;
};

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
    body: JSON.stringify({ poolTitles, libraryTitles, batchSize }),
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
  const out: Candidate[] = raw.map((r, i) => {
    const omdb =
      enriched[i].status === 'fulfilled' ? enriched[i].value : null;
    // Merge rules: OMDB wins for RT / IMDb / awards / year / poster / imdbId.
    // LLM wins for CSM age (OMDB has none) and studio (OMDB's Production
    // is usually "N/A" on the free tier).
    return {
      title: r.title,
      year: omdb?.year ?? r.year,
      imdbId: omdb?.imdbId ?? null,
      imdb: omdb?.imdb ?? r.imdb,
      rottenTomatoes: omdb?.rottenTomatoes ?? r.rottenTomatoes,
      commonSenseAge: r.commonSenseAge,
      studio: r.studio ?? omdb?.production ?? null,
      awards: omdb?.awards ?? r.awards,
      poster: omdb?.poster ?? null,
      addedAt: now,
    };
  });

  // Final client-side dedupe against pool + library.
  const ban = new Set<string>();
  for (const t of poolTitles) ban.add(t.toLowerCase());
  for (const t of libraryTitles) ban.add(t.toLowerCase());
  return out.filter((c) => !ban.has(c.title.toLowerCase()));
}

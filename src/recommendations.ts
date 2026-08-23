import type { Candidate, Movie } from './types';
import { dedupKey, enrichCandidate, normalizeTitle, type CandidateOmdbPatch } from './omdb';
import { DEFAULT_WEIGHTS, scoreCandidate, type ScoreContext, type ScoringWeights } from './scoring';
import { supabase } from './supabase';
import { parseNameList } from './format';
import type { TasteProfile } from './taste';

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
  // Only live rows count toward duplicate detection — otherwise a merge
  // survivor still shares a dedupKey with its soft-removed twin and would be
  // wrongly treated as a duplicate, undercounting the eligible pool.
  const counts = new Map<string, number>();
  for (const c of candidates) {
    if (c.removedAt != null) continue;
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
  const knownDirectors = extractUnique(library.flatMap((m) => m.directors ?? []));
  const knownWriters = extractUnique(library.flatMap((m) => m.writers ?? []));
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
  /**
   * Which watched film the model considers this a neighbour of. The endpoint
   * requires it so every pick has to be justified against a seed instead of
   * free-associated; it isn't persisted on the Candidate, and is declared here
   * only to document the wire shape.
   */
  similarTo?: string | null;
  director?: string | null;
  writer?: string | null;
  directors?: string[] | null;
  writers?: string[] | null;
  rottenTomatoes: string | null;
  imdb: string | null;
};

/**
 * Deduplicate + sort a flat list of creator names. Drops blanks / "N/A".
 * Used to build director/writer/studio lists from library movies.
 */
export function extractUnique(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const s of raw) {
    if (!s) continue;
    const trimmed = s.trim();
    if (trimmed && trimmed !== 'N/A') seen.add(trimmed);
  }
  return [...seen].sort();
}

/**
 * Progress signal for the admin pool-expansion flow, surfaced so the UI can
 * show which stage it's in — and, during the slow OMDB pass, how many titles
 * have been checked and kept — instead of a blind multi-second spinner.
 */
export type ExpandProgress =
  | { stage: 'requesting' }
  | { stage: 'enriching'; done: number; total: number; kept: number }
  // `saving` is set by the caller while it writes the batch to Supabase;
  // expandPool itself only emits requesting / enriching / done.
  | { stage: 'saving' }
  | { stage: 'done'; added: number };

// OMDB's free tier rate-limits bursts hard. Enriching the whole batch at once
// (the old all-`Promise.all` approach) tripped the limiter and silently
// dropped almost every title, so the pool grew by one or two per press.
// Enrich a few at a time instead — the same conservative throttling the bulk
// refreshers already use.
const OMDB_CONCURRENCY = 4;

/**
 * Admin-only: request a fresh batch of candidate films from the LLM, enrich
 * each one via OMDB (throttled), and return a fully-formed Candidate[] ready
 * to append to the pool. Does NOT write to Supabase — the caller does that
 * through `useCandidatePool.appendCandidates`. Reports progress via the
 * optional `onProgress` callback.
 *
 * The LLM over-delivers (the server returns more than `batchSize`) because
 * OMDB can't confirm every title; we enrich until `batchSize` verified
 * survivors are collected, then stop to save free-tier OMDB quota.
 *
 * `taste` (from `buildTasteProfile` in ./taste) is what makes the results
 * *similar* to the family's watched films rather than a generic "best family
 * movies" dump. Callers should always pass it.
 */
export async function expandPool(
  poolTitles: string[],
  libraryTitles: string[],
  batchSize: number = 100,
  taste?: TasteProfile,
  onProgress?: (p: ExpandProgress) => void,
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

  onProgress?.({ stage: 'requesting' });

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
      taste,
      // Legacy flat fields, kept so a request served by an older function
      // deploy still gets a (weaker) taste signal rather than none.
      directors: taste?.directors ?? [],
      writers: taste?.writers ?? [],
      studios: taste?.studios ?? [],
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    const base = body.error || `HTTP ${resp.status}`;
    throw new Error(body.detail ? `${base} — ${body.detail}` : base);
  }

  const data = (await resp.json()) as { items: RawCandidateFromApi[] };
  const raw = Array.isArray(data.items) ? data.items : [];
  if (raw.length === 0) {
    onProgress?.({ stage: 'done', added: 0 });
    return [];
  }

  // Never re-add a title already in the pool or the library. Kept titles are
  // added to this set too, so an intra-batch duplicate (the LLM naming the
  // same film twice) is skipped rather than seeded twice. `seenImdbIds` catches
  // the same film reached via two different title spellings that OMDB resolves
  // to one id; appendCandidates does the final imdbId dedupe against the pool.
  const ban = new Set<string>();
  for (const t of poolTitles) ban.add(t.toLowerCase());
  for (const t of libraryTitles) ban.add(t.toLowerCase());
  const seenImdbIds = new Set<string>();

  const now = new Date().toISOString();
  const total = raw.length;
  const out: Candidate[] = [];
  let done = 0;
  let cursor = 0;
  onProgress?.({ stage: 'enriching', done: 0, total, kept: 0 });

  // Throttled workers share a cursor into `raw`. Each stops pulling new
  // titles once `out` holds a full batch of OMDB-verified survivors.
  const worker = async () => {
    while (cursor < raw.length && out.length < batchSize) {
      const r = raw[cursor++];
      const key = r.title.toLowerCase();
      let omdb: CandidateOmdbPatch | null = null;
      if (!ban.has(key)) {
        try {
          // Pass the year through: it disambiguates remakes and rescues
          // titles whose OMDB relevance ranking buries the real film.
          omdb = await enrichCandidate(r.title, r.year);
        } catch {
          omdb = null;
        }
      }
      done++;
      // OMDB gates the pool: searchMovies is type-filtered to films, so a
      // null enrichment means OMDB couldn't confirm this title as a movie.
      // Drop it rather than let an LLM-hallucinated TV show slip in unlinked.
      const idKey = omdb ? omdb.imdbId.toLowerCase() : null;
      if (
        omdb &&
        !ban.has(key) &&
        !(idKey && seenImdbIds.has(idKey)) &&
        out.length < batchSize
      ) {
        ban.add(key);
        if (idKey) seenImdbIds.add(idKey);
        // Merge rules: OMDB wins for RT / IMDb / awards / year / poster /
        // imdbId. LLM wins for CSM age (OMDB has none) and studio (OMDB's
        // Production is usually "N/A" on the free tier).
        out.push({
          title: r.title,
          year: omdb.year ?? r.year,
          imdbId: omdb.imdbId,
          imdb: omdb.imdb ?? r.imdb,
          rottenTomatoes: omdb.rottenTomatoes ?? r.rottenTomatoes,
          commonSenseAge: r.commonSenseAge,
          studio: r.studio ?? omdb.production ?? null,
          awards: omdb.awards ?? r.awards,
          directors: omdb.directors ?? parseNameList(r.directors ?? r.director),
          writers: omdb.writers ?? parseNameList(r.writers ?? r.writer),
          poster: omdb.poster ?? null,
          addedAt: now,
          type: omdb.type,
        });
      }
      onProgress?.({ stage: 'enriching', done, total, kept: out.length });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(OMDB_CONCURRENCY, raw.length) }, worker),
  );

  onProgress?.({ stage: 'done', added: out.length });
  return out;
}

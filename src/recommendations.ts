import type { Candidate, Movie } from './types';
import { dedupKey, enrichCandidate, enrichCandidateVerified, normalizeTitle, type CandidateOmdbPatch } from './omdb';
import { DEFAULT_WEIGHTS, scoreCandidate, type ScoreContext, type ScoringWeights } from './scoring';
import { supabase } from './supabase';
import { parseNameList } from './format';

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

// Identity and catalog validity determine eligibility; missing review scores
// remain unknown and are handled by scoring, not a hidden exclusion gate.
function eligibleCandidates(candidates: Candidate[], library: Movie[]): Candidate[] {
  const { imdbIds, titles } = buildLibrarySets(library);
  const live = candidates.filter(c => c.removedAt == null && c.removedReason == null);
  const counts = new Map<string, number>();
  for (const c of live) {
    const key = dedupKey(c.title);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return live.filter(c =>
    !!c.imdbId &&
    (c.type == null || c.type === 'movie') &&
    counts.get(dedupKey(c.title)) === 1 &&
    !imdbIds.has(c.imdbId) &&
    !titles.has(normalizeTitle(c.title)),
  );
}

/** Count the same eligible movies used for ranking, before the display limit. */
export function countEffectiveCandidates(candidates: Candidate[], library: Movie[] = []): number {
  return eligibleCandidates(candidates, library).length;
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
  const knownDirectors = extractUnique(library.flatMap((m) => m.directors ?? []));
  const knownWriters = extractUnique(library.flatMap((m) => m.writers ?? []));
  const ctx: ScoreContext = { knownDirectors, knownWriters };
  const scored: RankedPick[] = eligibleCandidates(candidates, library)
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
  imdbId?: string | null;
  year: number | null;
  commonSenseAge: string | null;
  studio: string | null;
  awards: string | null;
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
 */
export type ExpansionMode = 'baseline' | 'enhanced';
export type ExpansionOptions = {
  mode?: ExpansionMode;
  focus?: string;
  existingMovies?: Array<{ title: string; year?: number | null; imdbId?: string | null }>;
};
export type ExpansionReport = {
  mode: ExpansionMode;
  candidates: Candidate[];
  raw: number;
  checked: number;
  unmatched: number;
  errors: number;
  duplicates: number;
  verified: number;
  status: 'complete' | 'partial';
  api: { requested?: number; candidateTarget?: number; returned?: number; rawGenerated?: number; skippedExisting?: number; duplicatesWithinBatch?: number; elapsedMs?: number; status?: string; completionObserved?: boolean; sourceUrls?: string[]; focus?: string };
};

export async function expandPool(
  poolTitles: string[], libraryTitles: string[], batchSize = 100,
  libraryContext?: { directors: string[]; writers: string[]; studios: string[] },
  onProgress?: (p: ExpandProgress) => void,
): Promise<Candidate[]> {
  return (await expandPoolDetailed(poolTitles, libraryTitles, batchSize, libraryContext, onProgress)).candidates;
}

export async function expandPoolDetailed(
  poolTitles: string[], libraryTitles: string[], batchSize = 100,
  libraryContext?: { directors: string[]; writers: string[]; studios: string[] },
  onProgress?: (p: ExpandProgress) => void,
  options: ExpansionOptions = {},
): Promise<ExpansionReport> {
  if (!supabase) throw new Error('Auth is not configured — cannot expand pool.');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sign in required to expand the pool.');
  const mode = options.mode ?? 'enhanced';
  onProgress?.({ stage: 'requesting' });
  const resp = await fetch('/api/recommendations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ poolTitles, libraryTitles, batchSize, mode, focus: options.focus,
      existingMovies: options.existingMovies,
      directors: libraryContext?.directors ?? [], writers: libraryContext?.writers ?? [], studios: libraryContext?.studios ?? [] }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    const base = body.error || `HTTP ${resp.status}`;
    throw new Error(body.detail ? `${base} — ${body.detail}` : base);
  }
  const data = await resp.json() as { items?: RawCandidateFromApi[]; metrics?: ExpansionReport['api'] };
  const raw = Array.isArray(data.items) ? data.items : [];
  const report: ExpansionReport = { mode, candidates: [], raw: raw.length, checked: 0, unmatched: 0, errors: 0, duplicates: 0, verified: 0, status: 'complete', api: data.metrics ?? {} };
  const titleBan = new Set([...poolTitles, ...libraryTitles].map(normalizeTitle));
  const knownIds = new Set((options.existingMovies ?? []).flatMap(m => m.imdbId ? [m.imdbId.toLowerCase()] : []));
  const knownIdentities = new Set((options.existingMovies ?? []).map(m => `${normalizeTitle(m.title)}:${m.year ?? ''}`));
  const queued = new Set<string>();
  const seenIds = new Set<string>();
  let cursor = 0;
  const now = new Date().toISOString();
  const worker = async () => {
    while (cursor < raw.length && report.candidates.length < batchSize) {
      const r = raw[cursor++];
      const title = normalizeTitle(r.title);
      const identity = `${title}:${r.year ?? ''}`;
      const key = mode === 'baseline' ? title : identity;
      const existing = mode === 'baseline' || !options.existingMovies ? titleBan.has(title) : knownIdentities.has(identity);
      if (existing || queued.has(key)) { report.duplicates++; continue; }
      queued.add(key);
      let omdb: CandidateOmdbPatch | null;
      report.checked++;
      try {
        omdb = mode === 'baseline' ? await enrichCandidate(r.title) : await enrichCandidateVerified(r.title, { year: r.year, imdbId: r.imdbId });
      } catch {
        report.errors++;
        onProgress?.({ stage: 'enriching', done: report.checked, total: raw.length, kept: report.candidates.length });
        continue;
      }
      if (!omdb) report.unmatched++;
      else if (seenIds.has(omdb.imdbId.toLowerCase()) || knownIds.has(omdb.imdbId.toLowerCase())) report.duplicates++;
      else if (report.candidates.length < batchSize) {
        seenIds.add(omdb.imdbId.toLowerCase());
        report.candidates.push({
          title: r.title, year: omdb.year ?? r.year, imdbId: omdb.imdbId,
          releaseDate: omdb.releaseDate ?? null,
          imdb: mode === 'baseline' ? omdb.imdb ?? r.imdb : omdb.imdb,
          rottenTomatoes: mode === 'baseline' ? omdb.rottenTomatoes ?? r.rottenTomatoes : omdb.rottenTomatoes,
          commonSenseAge: mode === 'baseline' ? r.commonSenseAge : null,
          studio: omdb.production ?? (mode === 'baseline' ? r.studio : null),
          awards: mode === 'baseline' ? omdb.awards ?? r.awards : omdb.awards,
          directors: omdb.directors ?? (mode === 'baseline' ? parseNameList(r.directors ?? r.director) : null),
          writers: omdb.writers ?? (mode === 'baseline' ? parseNameList(r.writers ?? r.writer) : null),
          poster: omdb.poster, addedAt: now, type: omdb.type,
        });
      }
      onProgress?.({ stage: 'enriching', done: report.checked, total: raw.length, kept: report.candidates.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(OMDB_CONCURRENCY, raw.length) }, worker));
  report.verified = report.candidates.length;
  if (report.errors || (report.api.status && report.api.status !== 'complete')) report.status = 'partial';
  onProgress?.({ stage: 'done', added: report.verified });
  return report;
}

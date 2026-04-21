import { supabase } from './supabase';
import { getMovieById, OmdbError } from './omdb';

/**
 * Two-stage enrichment for studio + awards:
 *
 * 1. OMDB is authoritative for awards. For every movie with an imdbId we
 *    fetch its canonical `Awards` string (sourced from IMDb). Claude
 *    hallucinates plausible-but-wrong awards for recent or obscure titles
 *    — e.g. claiming LEO (2023) won a Golden Globe — so we never trust
 *    Claude for awards when OMDB has an answer.
 *
 * 2. Claude fills in studio (OMDB's free tier returns "N/A" for Production
 *    on most titles) and serves as the awards fallback for unlinked movies
 *    or cases where OMDB had nothing. Prompt is tuned to prefer blank over
 *    guessing.
 *
 * OMDB awards always win over Claude awards. Input order is preserved via
 * index matching.
 */

export type EnrichInput = {
  title: string;
  year: number | null;
  imdbId: string | null;
};

export type EnrichedFields = {
  title: string;
  production: string | null;
  awards: string | null;
};

export async function enrichMovies(
  movies: EnrichInput[],
): Promise<EnrichedFields[]> {
  if (movies.length === 0) return [];

  // OMDB lookups run in parallel — no rate-limit throttle because batches are
  // already capped at 50 by the caller (EnhanceAllSheet). For unlinked
  // entries this resolves immediately to null.
  const omdbAwardsP = Promise.all(
    movies.map((m) =>
      m.imdbId ? fetchOmdbAwards(m.imdbId) : Promise.resolve(null),
    ),
  );

  // Run OMDB and Claude concurrently — Claude has to cover studio for every
  // movie anyway, so there's no point gating Claude on OMDB finishing first.
  const [omdbAwards, claudeResults] = await Promise.all([
    omdbAwardsP,
    callClaude(movies),
  ]);

  return movies.map((m, i) => ({
    title: m.title,
    production: claudeResults[i]?.production ?? null,
    awards: omdbAwards[i] ?? claudeResults[i]?.awards ?? null,
  }));
}

async function fetchOmdbAwards(imdbId: string): Promise<string | null> {
  try {
    const patch = await getMovieById(imdbId);
    return patch.awards;
  } catch (e) {
    // not-configured → no OMDB key in this env, fall through to Claude.
    // not-found / network → swallow, let Claude try.
    if (e instanceof OmdbError) return null;
    return null;
  }
}

async function callClaude(movies: EnrichInput[]): Promise<EnrichedFields[]> {
  if (!supabase) {
    throw new Error('Auth is not configured — cannot enrich movies.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Sign in required to enrich movies.');
  }

  const resp = await fetch('/api/enrich', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ movies }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    const base = body.error || `HTTP ${resp.status}`;
    throw new Error(body.detail ? `${base} — ${body.detail}` : base);
  }

  const data = (await resp.json()) as { items: EnrichedFields[] };
  return Array.isArray(data.items) ? data.items : [];
}

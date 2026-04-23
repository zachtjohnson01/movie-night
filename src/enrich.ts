import { supabase } from './supabase';
import { getMovieById, OmdbError } from './omdb';
import { parseNameList } from './format';

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
  directors: string[] | null;
  writers: string[] | null;
};

export async function enrichMovies(
  movies: EnrichInput[],
): Promise<EnrichedFields[]> {
  if (movies.length === 0) return [];

  // OMDB lookups run in parallel — no rate-limit throttle because batches are
  // already capped at 50 by the caller (EnhanceAllSheet). For unlinked
  // entries this resolves immediately to null.
  const omdbFieldsP = Promise.all(
    movies.map((m) =>
      m.imdbId ? fetchOmdbFields(m.imdbId) : Promise.resolve(null),
    ),
  );

  // Run OMDB and Claude concurrently — Claude has to cover studio for every
  // movie anyway, so there's no point gating Claude on OMDB finishing first.
  const [omdbFields, claudeResults] = await Promise.all([
    omdbFieldsP,
    callClaude(movies),
  ]);

  return movies.map((m, i) => ({
    title: m.title,
    production: claudeResults[i]?.production ?? null,
    // OMDB is authoritative for awards, directors, writers when linked.
    awards: omdbFields[i]?.awards ?? claudeResults[i]?.awards ?? null,
    directors: omdbFields[i]?.directors ?? claudeResults[i]?.directors ?? null,
    writers: omdbFields[i]?.writers ?? claudeResults[i]?.writers ?? null,
  }));
}

type OmdbFields = {
  awards: string | null;
  directors: string[] | null;
  writers: string[] | null;
};

async function fetchOmdbFields(imdbId: string): Promise<OmdbFields | null> {
  try {
    const patch = await getMovieById(imdbId);
    return {
      awards: patch.awards,
      directors: patch.directors,
      writers: patch.writers,
    };
  } catch (e) {
    // not-configured → no OMDB key in this env, fall through to Claude.
    // not-found / network → swallow, let Claude try.
    if (e instanceof OmdbError) return null;
    return null;
  }
}

// The `/api/enrich` endpoint still returns `director`/`writer` as comma-
// separated strings (server-side Claude prompt shape). We parse them into
// the new `directors`/`writers` array shape on the way in so the rest of
// the app only deals with arrays.
type ClaudeEnrichedRaw = {
  title: string;
  production: string | null;
  awards: string | null;
  director?: string | null;
  writer?: string | null;
  directors?: string[] | null;
  writers?: string[] | null;
};

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

  const data = (await resp.json()) as { items: ClaudeEnrichedRaw[] };
  if (!Array.isArray(data.items)) return [];
  return data.items.map((item) => ({
    title: item.title,
    production: item.production ?? null,
    awards: item.awards ?? null,
    directors: parseNameList(item.directors ?? item.director),
    writers: parseNameList(item.writers ?? item.writer),
  }));
}

import { supabase } from './supabase';

/**
 * Client helper for the /api/enrich endpoint. Sends a batch of titles to the
 * server, which proxies to Claude Haiku and returns the lead production
 * studio + a brief awards summary for each. Auth is enforced server-side
 * (admin allowlist); without a live Supabase session the call won't even
 * be attempted.
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

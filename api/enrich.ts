import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Mirrors the allowlist in src/useAuth.ts and api/recommendations.ts. Kept in
// sync manually — for a 2-user family app the drift risk is negligible. This
// is the enforcement point for anything that spends Anthropic credits.
const ALLOWED_ADMIN_EMAILS = new Set([
  'zachtjohnson01@gmail.com',
  'alexandrabjohnson01@gmail.com',
]);

type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: number; error: string };

async function authenticate(req: VercelRequest): Promise<AuthResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok: false,
      status: 503,
      error:
        'Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.',
    };
  }
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { ok: false, status: 401, error: 'Missing Authorization header' };
  }
  const token = match[1];
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
  const email = (data.user.email ?? '').toLowerCase();
  if (!ALLOWED_ADMIN_EMAILS.has(email)) {
    return {
      ok: false,
      status: 403,
      error: 'Not authorized to enrich movies',
    };
  }
  return { ok: true, email };
}

/**
 * Studio + awards backfill endpoint. Asks Claude for the lead production
 * studio and a one-line awards summary for each input title. Used by the
 * "Enhance all" buttons on the Watched and Wishlist tabs to fill in the
 * `production` and `awards` fields for movies that don't have them yet
 * (typically older manual entries or movies linked to OMDB before those
 * fields existed, since OMDB's free tier returns "N/A" for Production
 * far more often than not).
 *
 * POST { movies: Array<{ title, year, imdbId }> }
 *   -> { items: Array<{ title, production, awards }> }
 *
 * Items are returned in input order; the client matches them by index, not
 * by title, since Claude sometimes reformats the title slightly.
 */

type MovieInput = {
  title: string;
  year: number | null;
  imdbId: string | null;
};

type EnrichedFields = {
  title: string;
  production: string | null;
  awards: string | null;
};

const MAX_BATCH = 100;

function buildPrompt(movies: MovieInput[]): string {
  const list = movies
    .map((m, i) => {
      const year = m.year ? ` (${m.year})` : '';
      const id = m.imdbId ? ` [${m.imdbId}]` : '';
      return `${i + 1}. ${m.title}${year}${id}`;
    })
    .join('\n');
  return `You will receive a numbered list of feature films. For each film, return the lead production studio and a brief awards summary.

FILMS:

${list}

Return ONLY a JSON array with one object per film, in the SAME ORDER as the input. Each object shape:
{"title":"","production":"","awards":""}

- "title": echo the input title exactly
- "production": lead production company (e.g. "Pixar Animation Studios", "Studio Ghibli", "Walt Disney Pictures"). Use "" if genuinely unknown.
- "awards": one-line summary like "Won 1 Oscar. 14 wins & 13 nominations." or "BAFTA-nominated. 3 wins." Use "" if no notable awards.

Return exactly ${movies.length} items in the array, in input order. No prose, no code fences.`;
}

function parseEnriched(text: string): EnrichedFields[] {
  if (!text) return [];
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  const slice = t.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (r: unknown): r is Record<string, unknown> =>
          !!r && typeof r === 'object',
      )
      .map((r) => ({
        title: typeof r.title === 'string' ? r.title : '',
        production:
          typeof r.production === 'string' && r.production.trim()
            ? r.production.trim()
            : null,
        awards:
          typeof r.awards === 'string' && r.awards.trim()
            ? r.awards.trim()
            : null,
      }));
  } catch {
    return [];
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req);
  if (auth.ok === false) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Enrichment is not configured. Set ANTHROPIC_API_KEY in Vercel.',
    });
  }

  const body = req.body || {};
  const rawMovies = Array.isArray(body.movies) ? body.movies : [];
  const movies: MovieInput[] = rawMovies
    .filter(
      (m: unknown): m is Record<string, unknown> =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as Record<string, unknown>).title === 'string',
    )
    .slice(0, MAX_BATCH)
    .map((m) => ({
      title: String(m.title).trim(),
      year: typeof m.year === 'number' ? m.year : null,
      imdbId: typeof m.imdbId === 'string' ? m.imdbId : null,
    }));

  if (movies.length === 0) {
    return res.json({ items: [] });
  }

  const prompt = buildPrompt(movies);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        // 100 items × ~80 tokens output each ≈ 8K. Stays under the
        // non-streaming 16K guard so we can keep this endpoint simple.
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '(no body)');
      console.error('[enrich] anthropic error', resp.status, errText);
      return res.status(502).json({
        error: `Anthropic API returned ${resp.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    const parsed = parseEnriched(text);

    return res.json({ items: parsed });
  } catch (e) {
    console.error('[enrich] fetch error', e);
    return res
      .status(500)
      .json({ error: 'Could not reach enrichment service' });
  }
}

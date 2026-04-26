import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Authorization is membership-driven post-PR5: any family_members row
// belonging to the authenticated user with `is_global_owner = true`
// passes. This is the enforcement point for anything that spends
// Anthropic credits.
//
// Inlined rather than imported from api/_lib because Vercel's function
// bundler drops _lib modules from the deploy of api/* handlers (see
// CLAUDE.md gotchas).

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
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
  const { data: members, error: memErr } = await supabase
    .from('family_members')
    .select('is_global_owner')
    .eq('user_id', userData.user.id);
  if (memErr) {
    console.error('[enrich] family_members lookup failed', memErr);
    return { ok: false, status: 500, error: 'Authorization check failed' };
  }
  const isGlobalOwner = (members ?? []).some(
    (m: { is_global_owner: boolean }) => m.is_global_owner === true,
  );
  if (!isGlobalOwner) {
    return {
      ok: false,
      status: 403,
      error: 'Not authorized to enrich movies',
    };
  }
  return { ok: true, email: userData.user.email ?? '' };
}

/**
 * Studio + awards backfill endpoint. Asks Claude for the lead production
 * studio and (as a fallback) an awards summary for each input title.
 *
 * On the client side, src/enrich.ts pairs this endpoint with OMDB: OMDB is
 * authoritative for awards (its Awards string comes from IMDb) and runs in
 * parallel for every movie with an imdbId. Claude is the only source for
 * studio — OMDB's free tier returns "N/A" for Production on most titles —
 * and a best-effort fallback for awards when the movie isn't linked or
 * OMDB had nothing. The prompt is tuned to prefer blank over a guess to
 * avoid hallucinated awards on recent/obscure films.
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
  director: string | null;
  writer: string | null;
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

Return ONLY a JSON array with one object per film, in the SAME ORDER as the input. No prose, no code fences. Each object shape:
{"title":"","production":"","awards":"","director":"","writer":""}

RULES:

- "title": echo the input title exactly.

- "production": lead production company (e.g. "Pixar Animation Studios", "Studio Ghibli", "Walt Disney Pictures", "Illumination", "DreamWorks Animation"). Use "" if you don't know.

- "awards": ONLY include awards if you are HIGHLY confident the film actually won or was seriously nominated for a major award — Academy Awards (Oscars), BAFTAs, Golden Globes, Cannes, Annies (for animation), or Critics' Choice. DO NOT guess. Most films have no notable awards; blank is the correct answer in that case. If you are unsure, if the film is recent (last 2 years), or if you might be confusing it with a similarly-titled film, return "". A wrong award is much worse than no award. Format when non-empty: "Won 1 Oscar. 14 wins & 13 nominations." or "BAFTA-nominated. 3 wins." Empty string is strongly preferred over any guess.

- "director": director name(s), comma-separated (e.g. "Hayao Miyazaki"). Use "" if you don't know.

- "writer": primary screenwriter(s), comma-separated. Use "" if you don't know.

When an input line includes a bracketed "[tt...]" value, that's the canonical IMDb ID — use it to disambiguate films that share a title.

Return exactly ${movies.length} items in the array, in input order.`;
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
        director:
          typeof r.director === 'string' && r.director.trim()
            ? r.director.trim()
            : null,
        writer:
          typeof r.writer === 'string' && r.writer.trim()
            ? r.writer.trim()
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
    .map((m: Record<string, unknown>) => ({
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

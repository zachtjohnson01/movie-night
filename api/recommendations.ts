import type { VercelRequest, VercelResponse } from '@vercel/node';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

type InboundMovie = {
  title: string;
  watched?: boolean;
  commonSenseAge?: string | null;
  rottenTomatoes?: string | null;
  imdb?: string | null;
  notes?: string | null;
};

type RecItem = {
  title: string;
  year: number | null;
  commonSenseAge: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
  studio: string | null;
  awards: string | null;
  fitScore: number | null;
  why: string;
};

function buildPrompt(
  movies: InboundMovie[],
  existingRecs: string[],
  batchSize: number,
): string {
  const watchedLines = movies
    .filter((m) => m.watched)
    .map((m) => {
      const meta: string[] = [];
      if (m.commonSenseAge) meta.push(`CSM${m.commonSenseAge}`);
      if (m.rottenTomatoes) meta.push(`RT${m.rottenTomatoes}`);
      if (m.imdb) meta.push(`IMDb${m.imdb}`);
      const head = meta.length ? `${m.title} [${meta.join(' ')}]` : m.title;
      return m.notes ? `${head} — "${m.notes}"` : head;
    })
    .join('\n');

  const skipWatched = movies.filter((m) => m.watched).map((m) => m.title);
  const skipWishlist = movies.filter((m) => !m.watched).map((m) => m.title);

  const skipBlocks: string[] = [];
  if (skipWatched.length) skipBlocks.push(`Watched:\n${skipWatched.join(', ')}`);
  if (skipWishlist.length)
    skipBlocks.push(`Already on wishlist:\n${skipWishlist.join(', ')}`);
  if (existingRecs.length)
    skipBlocks.push(`Previously recommended:\n${existingRecs.join(', ')}`);
  const allSkips = skipBlocks.join('\n\n');

  const overRequest = Math.ceil(batchSize * 1.3);

  return `Recommending family films for Friday Movie Night (parent + young child).

❌ BAN LIST — if your response includes ANY of these, it is INVALID:

${allSkips}

✅ Use these watched favorites as TONAL SIGNALS (do not repeat them):

${watchedLines}

TASK: Return ${overRequest} NEW films NOT on the ban list, ranked best-fit first. Go beyond the obvious — surface films matching the signals above that aren't already on their radar.

Ranking priority:
1. RT ≥ 90% AND IMDb ≥ 7.5 (hard preference).
2. CSM age 5–8 (9+ only if exceptional).
3. Studio pedigree — Ghibli, Cartoon Saloon, Aardman, Laika, Pixar, Disney, DreamWorks, Sony Animation, GKIDS, strong indies.
4. Major awards — Oscar (Best Animated Feature), Annie, BAFTA, Annecy, Cannes.
5. Notes/vibe match from the signals above.
6. Tonal similarity (tiebreaker).

Favor variety across studios and decades. Include international animation, indie, and lesser-known gems alongside sure bets.

Return ONLY a JSON array. Keep "why" to ONE short sentence (<70 chars) referencing a specific watched title. Each object:
{"title":"","year":0,"commonSenseAge":"6+","rottenTomatoes":"95%","imdb":"7.8","studio":"","awards":"","fitScore":0,"why":""}`;
}

function parseRecs(text: string): RecItem[] {
  if (!text) return [];
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = t.indexOf('[');
  if (start === -1) return [];

  const candidates: string[] = [];
  const end = t.lastIndexOf(']');
  if (end > start) candidates.push(t.slice(start, end + 1));

  // Recover truncated JSON by finding the last complete `}`.
  const body = t.slice(start + 1);
  let depthObj = 0;
  let depthArr = 0;
  let inStr = false;
  let esc = false;
  let lastComplete = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depthObj++;
    else if (ch === '}') {
      depthObj--;
      if (depthObj === 0 && depthArr === 0) lastComplete = i;
    } else if (ch === '[') depthArr++;
    else if (ch === ']') depthArr--;
  }
  if (lastComplete >= 0) {
    candidates.push('[' + body.slice(0, lastComplete + 1) + ']');
  }

  for (const slice of candidates) {
    try {
      const arr = JSON.parse(slice);
      if (!Array.isArray(arr)) continue;
      const normalized: RecItem[] = arr
        .filter(
          (r: unknown): r is Record<string, unknown> =>
            !!r &&
            typeof r === 'object' &&
            typeof (r as Record<string, unknown>).title === 'string',
        )
        .map((r) => ({
          title: String(r.title).trim(),
          year:
            typeof r.year === 'number'
              ? r.year
              : parseInt(String(r.year ?? ''), 10) || null,
          commonSenseAge: r.commonSenseAge ? String(r.commonSenseAge) : null,
          rottenTomatoes: r.rottenTomatoes ? String(r.rottenTomatoes) : null,
          imdb: r.imdb ? String(r.imdb) : null,
          studio: r.studio ? String(r.studio).trim() : null,
          awards: r.awards ? String(r.awards).trim() : null,
          fitScore:
            typeof r.fitScore === 'number'
              ? r.fitScore
              : parseInt(String(r.fitScore ?? ''), 10) || null,
          why: r.why ? String(r.why).trim() : '',
        }));
      if (normalized.length) return normalized;
    } catch {
      // try next candidate
    }
  }
  return [];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:
        'Recommendations are not configured. Set ANTHROPIC_API_KEY in Vercel.',
    });
  }

  const body = req.body || {};
  const movies: InboundMovie[] = Array.isArray(body.movies) ? body.movies : [];
  const existingRecs: string[] = Array.isArray(body.existingRecs)
    ? body.existingRecs.filter((t: unknown): t is string => typeof t === 'string')
    : [];
  const batchSize: number =
    typeof body.batchSize === 'number' && body.batchSize > 0
      ? Math.min(body.batchSize, 20)
      : 10;

  if (movies.length === 0) {
    return res.status(400).json({ error: 'No movies in library' });
  }

  const prompt = buildPrompt(movies, existingRecs, batchSize);

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
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[recommendations] anthropic error', resp.status, errText);
      return res
        .status(502)
        .json({ error: `Anthropic API returned ${resp.status}` });
    }

    const payload = await resp.json();
    const text = (payload?.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n');

    const recs = parseRecs(text);

    return res.json({
      items: recs,
      rawCount: recs.length,
    });
  } catch (e) {
    console.error('[recommendations] fetch error', e);
    return res
      .status(500)
      .json({ error: `Could not reach recommendations service` });
  }
}

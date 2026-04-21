import type { VercelRequest, VercelResponse } from '@vercel/node';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Candidate-pool expansion endpoint. Asks Claude for a batch of family films
 * not already in `poolTitles` or `libraryTitles`, with LLM-sourced metadata
 * (the LLM is the only source for CSM age; OMDB is authoritative for RT,
 * IMDb, and Awards but runs client-side after this endpoint returns).
 *
 * POST { poolTitles: string[], libraryTitles: string[], batchSize: number }
 * -> { items: RawCandidate[], rawCount: number }
 */

type RawCandidate = {
  title: string;
  year: number | null;
  commonSenseAge: string | null;
  studio: string | null;
  awards: string | null;
  // Tentative scores from the LLM. Kept as fallbacks — the client overlays
  // OMDB's authoritative values on top before scoring.
  rottenTomatoes: string | null;
  imdb: string | null;
};

function buildPrompt(
  poolTitles: string[],
  libraryTitles: string[],
  batchSize: number,
): string {
  const overRequest = Math.ceil(batchSize * 1.25);
  const skipBlocks: string[] = [];
  if (libraryTitles.length)
    skipBlocks.push(`Already in the user's library:\n${libraryTitles.join(', ')}`);
  if (poolTitles.length)
    skipBlocks.push(`Already in the recommendation pool:\n${poolTitles.join(', ')}`);
  const banList = skipBlocks.join('\n\n') || '(none)';

  return `Building a deterministic recommendation pool of family films for Friday Movie Night (parent + young child, target CSM age 5–8).

BAN LIST — if ANY title in your output appears here the response is INVALID:

${banList}

TASK: Return ${overRequest} feature-length family films NOT on the ban list. Include a mix of animated and live-action, major studios and indie/international, across multiple decades. Favor films that are widely respected and would score well on RT + IMDb; the user's scoring model weights RT + IMDb most heavily, then CSM age, then studio pedigree, then awards.

Prefer films rated CSM 5–8. CSM 9+ is only worth including if the film is a genuine masterpiece. CSM ≤4 is fine but shouldn't dominate.

For each film, provide best-known metadata. Accuracy matters — the pool is persisted and reused across sessions. Use "N/A" sparingly; "null" is fine for fields you genuinely don't know.

Return ONLY a JSON array. Each object shape:
{"title":"","year":0,"commonSenseAge":"6+","studio":"","awards":"","rottenTomatoes":"95%","imdb":"7.8"}

- "commonSenseAge": format "N+" like "5+", "6+", "8+"
- "studio": the lead production company (e.g. "Studio Ghibli", "Pixar")
- "awards": brief summary like "Won Best Animated Feature Oscar" or "BAFTA-nominated". Empty string if none notable.
- "rottenTomatoes": "NN%" or null
- "imdb": "N.N" or null`;
}

function parseCandidates(text: string): RawCandidate[] {
  if (!text) return [];
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = t.indexOf('[');
  if (start === -1) return [];

  const candidates: string[] = [];
  const end = t.lastIndexOf(']');
  if (end > start) candidates.push(t.slice(start, end + 1));

  // Recover truncated JSON by finding the last complete `}` at depth 1.
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
      const normalized: RawCandidate[] = arr
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
          studio: r.studio ? String(r.studio).trim() : null,
          awards:
            r.awards && String(r.awards).trim()
              ? String(r.awards).trim()
              : null,
          rottenTomatoes: r.rottenTomatoes ? String(r.rottenTomatoes) : null,
          imdb: r.imdb ? String(r.imdb) : null,
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
  const poolTitles: string[] = Array.isArray(body.poolTitles)
    ? body.poolTitles.filter((t: unknown): t is string => typeof t === 'string')
    : [];
  const libraryTitles: string[] = Array.isArray(body.libraryTitles)
    ? body.libraryTitles.filter(
        (t: unknown): t is string => typeof t === 'string',
      )
    : [];
  const batchSize: number =
    typeof body.batchSize === 'number' && body.batchSize > 0
      ? Math.min(body.batchSize, 100)
      : 100;

  const prompt = buildPrompt(poolTitles, libraryTitles, batchSize);

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
        // 100 candidate items × ~150 tokens each + prompt ≈ 16K-20K tokens.
        max_tokens: 24000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[pool-expand] anthropic error', resp.status, errText);
      return res
        .status(502)
        .json({ error: `Anthropic API returned ${resp.status}` });
    }

    const payload = await resp.json();
    const text = (payload?.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n');

    const parsed = parseCandidates(text);

    // Server-side dedupe against the ban list as belt-and-suspenders;
    // client also dedupes before writing to Supabase.
    const banSet = new Set<string>();
    for (const t of poolTitles) banSet.add(t.toLowerCase());
    for (const t of libraryTitles) banSet.add(t.toLowerCase());
    const deduped = parsed.filter(
      (c) => !banSet.has(c.title.toLowerCase()),
    );

    return res.json({
      items: deduped.slice(0, batchSize),
      rawCount: parsed.length,
    });
  } catch (e) {
    console.error('[pool-expand] fetch error', e);
    return res
      .status(500)
      .json({ error: `Could not reach recommendations service` });
  }
}

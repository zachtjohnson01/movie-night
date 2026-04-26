import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Supabase env vars are set in Vercel with the VITE_ prefix so the Vite
// build inlines them for the client. Serverless functions see the same
// values via process.env regardless of prefix.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Authorization is membership-driven post-PR5: any family_members row
// belonging to the authenticated user with `is_global_owner = true`
// passes. The column has a column-level UPDATE revoke, so a malicious
// authenticated user can't escalate themselves into it. This is the
// enforcement point for anything that spends Anthropic credits.
//
// Inlined rather than imported from api/_lib because Vercel's function
// bundler drops _lib modules from the deploy of api/* handlers in this
// project (see CLAUDE.md gotchas).

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
    return {
      ok: false,
      status: 401,
      error: 'Missing Authorization header',
    };
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
    console.error('[recommendations] family_members lookup failed', memErr);
    return { ok: false, status: 500, error: 'Authorization check failed' };
  }
  const isGlobalOwner = (members ?? []).some(
    (m: { is_global_owner: boolean }) => m.is_global_owner === true,
  );
  if (!isGlobalOwner) {
    return {
      ok: false,
      status: 403,
      error: 'Not authorized to expand the recommendation pool',
    };
  }
  return { ok: true, email: userData.user.email ?? '' };
}

/**
 * Candidate-pool expansion endpoint. Asks Claude for a batch of family films
 * not already in `poolTitles` or `libraryTitles`, with LLM-sourced metadata
 * (the LLM is the only source for CSM age; OMDB is authoritative for RT,
 * IMDb, and Awards but runs client-side after this endpoint returns).
 *
 * POST { poolTitles: string[], libraryTitles: string[], batchSize: number,
 *         directors?: string[], writers?: string[], studios?: string[] }
 * -> { items: RawCandidate[], rawCount: number }
 */

type RawCandidate = {
  title: string;
  year: number | null;
  commonSenseAge: string | null;
  studio: string | null;
  awards: string | null;
  director: string | null;
  writer: string | null;
  // Tentative scores from the LLM. Kept as fallbacks — the client overlays
  // OMDB's authoritative values on top before scoring.
  rottenTomatoes: string | null;
  imdb: string | null;
};

function buildPrompt(
  poolTitles: string[],
  libraryTitles: string[],
  batchSize: number,
  directors: string[] = [],
  writers: string[] = [],
  studios: string[] = [],
): string {
  const overRequest = Math.ceil(batchSize * 1.25);
  const skipBlocks: string[] = [];
  if (libraryTitles.length)
    skipBlocks.push(`Already in the user's library:\n${libraryTitles.join(', ')}`);
  if (poolTitles.length)
    skipBlocks.push(`Already in the recommendation pool:\n${poolTitles.join(', ')}`);
  const banList = skipBlocks.join('\n\n') || '(none)';

  const tasteLines: string[] = [];
  if (directors.length) tasteLines.push(`Directors: ${directors.join(', ')}`);
  if (writers.length) tasteLines.push(`Writers: ${writers.join(', ')}`);
  if (studios.length) tasteLines.push(`Studios / production companies: ${studios.join(', ')}`);
  const tasteSection = tasteLines.length
    ? `FAMILY TASTE PROFILE — directors, writers, and studios from films they've already watched or wishlisted:
${tasteLines.join('\n')}

Prioritize discovering more films from these directors, writers, and studios that the family hasn't seen yet. Diversity across decades and styles is still valued — use this as a positive signal, not a hard constraint.

`
    : '';

  return `Building a deterministic recommendation pool of family films for Family Movie Night (parent + young child, target CSM age 5–8).

${tasteSection}BAN LIST — if ANY title in your output appears here the response is INVALID:

${banList}

TASK: Return ${overRequest} feature-length family films NOT on the ban list. Include a mix of animated and live-action, major studios and indie/international, across multiple decades. Favor films that are widely respected and would score well on RT + IMDb; the user's scoring model weights RT + IMDb most heavily, then CSM age, then studio pedigree, then awards.

Prefer films rated CSM 5–8. CSM 9+ is only worth including if the film is a genuine masterpiece. CSM ≤4 is fine but shouldn't dominate.

For each film, provide best-known metadata. Accuracy matters — the pool is persisted and reused across sessions. Use "N/A" sparingly; "null" is fine for fields you genuinely don't know.

Return ONLY a JSON array. Each object shape:
{"title":"","year":0,"commonSenseAge":"6+","studio":"","awards":"","director":"","writer":"","rottenTomatoes":"95%","imdb":"7.8"}

- "commonSenseAge": format "N+" like "5+", "6+", "8+"
- "studio": the lead production company (e.g. "Studio Ghibli", "Pixar")
- "awards": brief summary like "Won Best Animated Feature Oscar" or "BAFTA-nominated". Empty string if none notable.
- "director": director name(s), comma-separated. Empty string if unknown.
- "writer": primary screenwriter(s), comma-separated. Empty string if unknown.
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
          director:
            r.director && String(r.director).trim()
              ? String(r.director).trim()
              : null,
          writer:
            r.writer && String(r.writer).trim()
              ? String(r.writer).trim()
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

/**
 * Reads an Anthropic Messages API SSE stream and returns the concatenated
 * text output. We only care about `content_block_delta` events with
 * `text_delta` payloads — everything else (message_start, ping, usage,
 * message_stop) is metadata we don't need for parsing.
 */
async function readAnthropicStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines. Process complete events,
    // keep the trailing partial in the buffer.
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const evt = JSON.parse(data);
          if (
            evt.type === 'content_block_delta' &&
            evt.delta?.type === 'text_delta' &&
            typeof evt.delta.text === 'string'
          ) {
            text += evt.delta.text;
          }
        } catch {
          // skip malformed line
        }
      }
    }
  }

  return text;
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

  const auth = await authenticate(req);
  if (auth.ok === false) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:
        'Recommendations are not configured. Set ANTHROPIC_API_KEY in Vercel.',
    });
  }

  const body = req.body || {};
  const filterStrings = (v: unknown) =>
    Array.isArray(v) ? v.filter((t: unknown): t is string => typeof t === 'string') : [];
  const poolTitles: string[] = filterStrings(body.poolTitles);
  const libraryTitles: string[] = filterStrings(body.libraryTitles);
  const directors: string[] = filterStrings(body.directors);
  const writers: string[] = filterStrings(body.writers);
  const studios: string[] = filterStrings(body.studios);
  const batchSize: number =
    typeof body.batchSize === 'number' && body.batchSize > 0
      ? Math.min(body.batchSize, 100)
      : 100;

  const prompt = buildPrompt(poolTitles, libraryTitles, batchSize, directors, writers, studios);

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
        // Streaming is required because Anthropic 400s non-streaming requests
        // above ~16K max_tokens (HTTP-timeout guard).
        max_tokens: 24000,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok || !resp.body) {
      const errText = resp.body ? await resp.text() : '(no body)';
      console.error('[pool-expand] anthropic error', resp.status, errText);
      return res.status(502).json({
        error: `Anthropic API returned ${resp.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const text = await readAnthropicStream(resp.body);
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

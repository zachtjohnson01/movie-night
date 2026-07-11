import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// The pool is web-grounded now: Claude searches the web for real family films,
// which takes longer than a single completion. Give Vercel room to finish
// (also set in vercel.json's `functions` block, the authoritative source).
export const maxDuration = 60;

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
  // Carry the caller's token so the family_members read runs as *them*. The
  // roster is member-scoped RLS (is_family_member), so an anon client sees
  // zero rows and every owner check would false-negative into a 403.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
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

// Over-request generously: OMDB (client-side) can't verify every title, so the
// client needs a buffer of extra candidates to reach `batchSize` real, linkable
// movies. It enriches until it has enough and drops the rest.
const OVER_REQUEST_RATIO = 1.6;
const overRequestCount = (batchSize: number) =>
  Math.ceil(batchSize * OVER_REQUEST_RATIO);

// `target` is how many titles to ask the web-grounded model for per press,
// chosen by the admin in the UI. Smaller = a faster run (less to generate) and
// fewer credits; the hard deadline in generateCandidates keeps even a large
// target from ever 504-ing. The client caps the added movies at batchSize, and
// a saturated pool rarely yields more than a few dozen genuinely-new titles
// per press regardless.
function buildPrompt(
  poolTitles: string[],
  libraryTitles: string[],
  target: number,
  directors: string[] = [],
  writers: string[] = [],
  studios: string[] = [],
): string {
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

YOU HAVE A web_search TOOL — you MUST call it at least 3 times before writing any answer. The ban list already holds hundreds of the obvious family films, so titles pulled from memory will mostly be duplicates that get thrown away. Search the web to discover fresh, real titles this family doesn't already have. Use different angles across your searches, for example:
- recent critics' and year-end lists ("best kids movies 2024", "best family films 2025", "underrated animated movies")
- new and upcoming family films in theaters and on streaming (Disney+, Netflix, Prime, etc.)
- award and festival lists (Annecy, the Oscar/BAFTA animated-feature slates, family/children's film awards)
- more films from the family's favorite studios, directors, and writers (see the taste profile above)
- well-reviewed international and indie family films across different decades and countries
Prefer titles you actually saw on a page over ones you merely recall, and cross-check every candidate against the BAN LIST — drop anything already there.

TASK: Return up to ${target} feature-length family films NOT on the ban list — a mix of animated and live-action, major-studio and indie/international, across multiple decades. Freshness and quality beat hitting the number: a shorter list of genuinely new, real, well-regarded films is far better than a padded one with repeats or invented titles. The user's scoring model weights RT + IMDb most heavily, then CSM age, then studio pedigree, then awards.

Every title must be a REAL, released feature film that exists in IMDb — no made-up titles, no TV series, no shorts. Each suggestion is looked up in a movie database by its exact title; anything that doesn't resolve is silently discarded, so a wrong or invented title is a wasted slot. Do not repeat a title within your answer, and do not output anything on the ban list.

Prefer films rated CSM 5–8. CSM 9+ is only worth including if the film is a genuine masterpiece. CSM ≤4 is fine but shouldn't dominate.

Return ONLY a JSON array — no prose, no explanation. Keep each object to exactly these four fields so you can return more titles quickly; ratings, awards, and cast are filled in automatically from a database afterward, so DO NOT include them. Object shape:
{"title":"","year":0,"commonSenseAge":"6+","studio":""}

- "title": the film's exact canonical English title as it appears on IMDb, with correct spelling and punctuation and NO year or extra subtitle. This string is matched against a database automatically — an inexact title is dropped, so precision here directly controls how many suggestions actually land.
- "year": release year (an integer) — helps match the right film, especially for remakes.
- "commonSenseAge": format "N+" like "5+", "6+", "8+".
- "studio": the lead production company (e.g. "Studio Ghibli", "Pixar").`;
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

// Cap the number of web searches per expansion. Each search costs money and
// adds latency; a few across the query angles in the prompt is plenty, and
// keeping this low is part of staying under Vercel's 60s function limit.
const WEB_SEARCH_MAX_USES = 3;

// Hard wall-clock budget for the whole model call, kept safely under Vercel's
// 60s function limit. On expiry we abort the stream and return whatever titles
// have arrived (parseCandidates recovers a truncated array) — so a slow run
// degrades to "fewer titles" instead of a gateway 504.
const GENERATION_DEADLINE_MS = 30_000;

/**
 * Ask Claude (Sonnet 5) for a batch of candidate films, grounded in live web
 * search rather than parametric memory — the pool is large enough that
 * memory-only suggestions are almost all duplicates. Streams the response
 * (large JSON output + a big model need streaming to dodge HTTP timeouts) and
 * resumes across `pause_turn` boundaries, which the server-side web-search
 * loop can emit. Returns the concatenated assistant text; parseCandidates
 * pulls the JSON array out of it.
 */
async function generateCandidates(
  apiKey: string,
  prompt: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const tools = [
    // Basic web search (no server-side dynamic-filtering code execution) — it's
    // markedly faster per query than web_search_20260209, which matters for the
    // wall-clock budget. Sonnet 5 supports it fine.
    { type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES },
  ] as Anthropic.Messages.ToolUnion[];

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  // Abort the whole thing at the deadline so the function always returns before
  // Vercel's limit — no more 504s. Whatever streamed by then is kept.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), GENERATION_DEADLINE_MS);

  let text = '';
  try {
    // At most two rounds: a `pause_turn` means the server-side search loop hit
    // its iteration cap mid-flight — echo the partial assistant turn back and
    // let it continue. The final (non-paused) message carries the JSON.
    for (let round = 0; round < 2; round++) {
      const stream = client.messages.stream(
        {
          model: 'claude-sonnet-5',
          // Small ceiling: the trimmed 4-field shape for ~40 titles is only a
          // few thousand tokens. Thinking is disabled to cut latency; the
          // prompt's explicit "call web_search at least 3 times" keeps tool use
          // reliable without it.
          max_tokens: 8000,
          thinking: { type: 'disabled' },
          tools,
          messages,
        },
        { signal: controller.signal },
      );
      // Accumulate deltas so a mid-generation abort still yields the titles
      // produced so far (parseCandidates recovers the truncated JSON tail).
      let roundText = '';
      stream.on('text', (delta) => {
        roundText += delta;
      });

      let message: Anthropic.Messages.Message;
      try {
        message = await stream.finalMessage();
      } catch {
        // Deadline (or network) abort — keep whatever this round streamed.
        if (roundText) text = roundText;
        break;
      }
      text = message.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (message.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: message.content });
    }
  } finally {
    clearTimeout(deadline);
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
    const text = await generateCandidates(ANTHROPIC_API_KEY, prompt);
    const parsed = parseCandidates(text);

    // Server-side dedupe against the ban list as belt-and-suspenders;
    // client also dedupes before writing to Supabase.
    const banSet = new Set<string>();
    for (const t of poolTitles) banSet.add(t.toLowerCase());
    for (const t of libraryTitles) banSet.add(t.toLowerCase());
    const deduped = parsed.filter(
      (c) => !banSet.has(c.title.toLowerCase()),
    );

    // Return the full over-requested batch (not just batchSize): the client
    // enriches these against OMDB and keeps the first batchSize that verify,
    // so it needs the extras to absorb titles OMDB can't confirm.
    return res.json({
      items: deduped.slice(0, overRequestCount(batchSize)),
      rawCount: parsed.length,
    });
  } catch (e) {
    console.error('[pool-expand] fetch error', e);
    return res
      .status(500)
      .json({ error: `Could not reach recommendations service` });
  }
}

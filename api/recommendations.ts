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
 *         taste?: TasteProfile,
 *         directors?: string[], writers?: string[], studios?: string[] }
 * -> { items: RawCandidate[], rawCount: number }
 *
 * `taste` is the similarity signal (src/taste.ts) and is what the prompt is
 * built around. The flat `directors`/`writers`/`studios` arrays are the legacy
 * shape kept so an old cached client bundle mid-deploy still gets a usable
 * (if weaker) profile instead of an empty one.
 */

type RawCandidate = {
  title: string;
  year: number | null;
  commonSenseAge: string | null;
  studio: string | null;
  awards: string | null;
  director: string | null;
  writer: string | null;
  // Which watched film this was picked as a neighbour of. Not persisted on the
  // Candidate; it exists to force the model to ground every suggestion in the
  // taste profile rather than free-associating popular titles, and to give the
  // server something to check when it drops off-profile results.
  similarTo: string | null;
  // Tentative scores from the LLM. Kept as fallbacks — the client overlays
  // OMDB's authoritative values on top before scoring.
  rottenTomatoes: string | null;
  imdb: string | null;
};

/**
 * The taste profile the client derives from the family's **watched** library
 * (see src/taste.ts). Anchors are seed titles ordered best-loved first;
 * the creator/studio lists are ranked by demonstrated affinity, not
 * alphabetically. This is the similarity signal the prompt is built around.
 */
type TasteAnchor = {
  title: string;
  year: number | null;
  studio: string | null;
  directors: string[];
  commonSenseAge: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
  favorite: boolean;
};

type TasteProfile = {
  anchors: TasteAnchor[];
  directors: string[];
  writers: string[];
  studios: string[];
  watchedCount: number;
};

// Over-request generously: OMDB (client-side) can't verify every title, so the
// client needs a buffer of extra candidates to reach `batchSize` real, linkable
// movies. It enriches until it has enough and drops the rest.
const OVER_REQUEST_RATIO = 1.6;
const overRequestCount = (batchSize: number) =>
  Math.ceil(batchSize * OVER_REQUEST_RATIO);

// Upper bound on seed films echoed into the prompt. The client already
// trims to a dozen; this is the server-side guard so a hand-rolled request
// can't stuff the prompt with hundreds of anchor lines.
const MAX_PROMPT_ANCHORS = 15;

// Cap the number of web searches per expansion. Each search costs money and
// adds latency. Similarity sourcing needs more angles than the old generic
// prompt did — one or two per seed film plus a couple of director/studio
// sweeps — so this is higher than the original 3, but still bounded to stay
// under the wall-clock budget below.
const WEB_SEARCH_MAX_USES = 6;

// Hard wall-clock budget for the whole model call, kept safely under Vercel's
// 60s function limit (`maxDuration` above / vercel.json). On expiry we abort
// the stream and return whatever titles have arrived (parseCandidates recovers
// a truncated array) — so a slow run degrades to "fewer titles" instead of a
// gateway 504. Raised alongside WEB_SEARCH_MAX_USES: more searches need more
// room, and the leftover ~15s covers auth, JSON handling, and cold start.
const GENERATION_DEADLINE_MS = 45_000;

/** One profile seed rendered as a compact, scannable line. */
function anchorLine(a: TasteAnchor, i: number): string {
  const bits: string[] = [];
  bits.push(`${i + 1}. ${a.title}${a.year ? ` (${a.year})` : ''}`);
  if (a.studio) bits.push(a.studio);
  if (a.directors.length) bits.push(`dir. ${a.directors.join(' & ')}`);
  if (a.commonSenseAge) bits.push(`CSM ${a.commonSenseAge}`);
  const scores = [
    a.rottenTomatoes ? `RT ${a.rottenTomatoes}` : null,
    a.imdb ? `IMDb ${a.imdb}` : null,
  ].filter(Boolean);
  if (scores.length) bits.push(scores.join(', '));
  return bits.join(' - ') + (a.favorite ? ' [FAVORITE]' : '');
}

/**
 * Build the expansion prompt.
 *
 * The prompt is organised around **similarity to what the family actually
 * watched**, which is the thing the old version got wrong: it passed the
 * library only as a ban list ("don't return these") plus an alphabetical dump
 * of every credited name, so the model had no idea which films to find
 * neighbours of and fell back on generic "best family movies" listicles —
 * which are exactly the titles the 400-title pool already contains. Hence the
 * complaint that expansion barely pulls anything in.
 *
 * Now the taste profile leads: named seed titles with their metadata, ranked
 * creator lists, an explicit search strategy phrased as neighbour-finding, and
 * a required `similarTo` field so every suggestion has to be justified against
 * a seed instead of free-associated.
 *
 * `target` is how many titles to ask for per press, chosen by the admin in the
 * UI. Smaller = a faster run and fewer credits; the hard deadline in
 * generateCandidates keeps even a large target from ever 504-ing.
 */
export function buildPrompt(
  poolTitles: string[],
  libraryTitles: string[],
  target: number,
  taste: TasteProfile,
): string {
  const skipBlocks: string[] = [];
  if (libraryTitles.length)
    skipBlocks.push(`Already watched or wishlisted:\n${libraryTitles.join(', ')}`);
  if (poolTitles.length)
    skipBlocks.push(`Already in the recommendation pool:\n${poolTitles.join(', ')}`);
  const banList = skipBlocks.join('\n\n') || '(none)';

  const sections: string[] = [];

  sections.push(
    `You are sourcing NEW films for a family's movie-night recommendation pool (a parent watching with a young child, target Common Sense Media age 5-8).

YOUR GOAL: find real, released feature films that are as SIMILAR AS POSSIBLE to the films this family has already watched and loved, and that are NOT already on the ban list below. Similarity to the profile matters more than general popularity - a well-matched obscure film beats a famous mismatch.`,
  );

  if (taste.anchors.length) {
    const derivedFrom = taste.watchedCount
      ? `derived from ${taste.watchedCount} watched film${taste.watchedCount === 1 ? '' : 's'}`
      : 'derived from their library';
    sections.push(
      `FAMILY TASTE PROFILE (${derivedFrom})

SEED FILMS - this is what "similar" means here. Ordered best-loved first; [FAVORITE] means they explicitly starred it:
${taste.anchors.map(anchorLine).join('\n')}`,
    );
  }

  const rankedLines: string[] = [];
  if (taste.directors.length)
    rankedLines.push(`Directors they keep coming back to: ${taste.directors.join(', ')}`);
  if (taste.writers.length)
    rankedLines.push(`Writers: ${taste.writers.join(', ')}`);
  if (taste.studios.length)
    rankedLines.push(`Studios / production companies: ${taste.studios.join(', ')}`);
  if (rankedLines.length) {
    sections.push(
      `${rankedLines.join('\n')}

(These lists are ranked by how much the family liked the films involved, so the first few names carry the most signal.)`,
    );
  }

  sections.push(
    `HOW TO PICK CANDIDATES - work down this priority order:
1. Films by the directors, writers, and studios listed above that the family has NOT seen.
2. Films that critics, curators, or audiences explicitly recommend to people who liked the seed films ("if you liked X, watch Y", "movies like X", staff picks, curated similar-film lists).
3. Films that share the seeds' defining qualities even without a direct comparison: animation technique, tone, era, country of origin, themes, protagonist's age, emotional register.
4. Only after the above: highly-rated family films that fit the age band and would plausibly appeal to someone with this profile.

Aim for a spread across the seed films rather than twenty neighbours of a single one, and keep a mix of animated and live-action, major-studio and indie/international, and multiple decades.`,
  );

  sections.push(
    `YOU HAVE A web_search TOOL - you MUST call it at least 3 times (up to ${WEB_SEARCH_MAX_USES}) before writing any answer. The ban list already holds hundreds of the obvious family films, so titles pulled from memory or from generic listicles will mostly be duplicates that get thrown away.

Ground every search in the profile above. Strong queries:
- "movies like <seed film>" / "if you liked <seed film> watch next"
- "films similar to <seed film> letterboxd" or curated similar-film lists
- "<top director from the list> films" / "<top studio> best films"
- "<a defining quality of the seeds, e.g. hand-drawn coming-of-age animation> family films"

Weak queries - do NOT spend a search on these: "best kids movies 2024", "top family films", "best animated movies of all time". Those return the exact titles already on the ban list.

Prefer titles you actually saw on a page over ones you merely recall, and cross-check every candidate against the BAN LIST before including it.`,
  );

  sections.push(
    `BAN LIST - if ANY title in your output appears here the response is INVALID:

${banList}`,
  );

  sections.push(
    `TASK: return up to ${target} feature films that pass every rule above.

Quality beats quantity: a shorter list of genuinely new, real, well-matched films is far better than a padded one with repeats or invented titles. Every title must be a REAL, released feature film that exists in IMDb - no TV series, no shorts, no invented titles. Each suggestion is looked up in a movie database by exact title and year; anything that doesn't resolve is silently discarded, so a wrong title is a wasted slot. Never repeat a title within your answer.

Prefer films rated CSM 5-8. CSM 9+ is only worth including if the film is a genuine masterpiece and a strong match for a seed. CSM 4 and under is fine but shouldn't dominate.

Return ONLY a JSON array - no prose, no explanation. Ratings, awards, and cast are filled in automatically from a database afterward, so DO NOT include them. Object shape:
{"title":"","year":0,"commonSenseAge":"6+","studio":"","similarTo":""}

- "title": the film's exact canonical English title as it appears on IMDb, correct spelling and punctuation, NO year and no extra subtitle. This string is matched against a database automatically, so precision here directly controls how many suggestions actually land.
- "year": release year (an integer). Used to disambiguate remakes, so get it right.
- "commonSenseAge": format "N+" like "5+", "6+", "8+".
- "studio": the lead production company (e.g. "Studio Ghibli", "Pixar").
- "similarTo": the exact title of the SEED FILM above that this recommendation most resembles. Every object must name one; if you can't justify the pick against a seed, leave the film out.`,
  );

  return sections.join('\n\n');
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
          similarTo:
            r.similarTo && String(r.similarTo).trim()
              ? String(r.similarTo).trim()
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

/**
 * Coerce the client's taste payload into a trusted shape. The body is
 * user-controlled and lands verbatim in a prompt, so every field is
 * re-validated and the anchor list is capped rather than trusted.
 */
function normalizeTaste(
  raw: unknown,
  legacy: { directors: string[]; writers: string[]; studios: string[] },
): TasteProfile {
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((t: unknown): t is string => typeof t === 'string') : [];
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  const anchors: TasteAnchor[] = (Array.isArray(t.anchors) ? t.anchors : [])
    .filter(
      (a: unknown): a is Record<string, unknown> =>
        !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).title === 'string',
    )
    .slice(0, MAX_PROMPT_ANCHORS)
    .map((a) => ({
      title: String(a.title).trim(),
      year: typeof a.year === 'number' ? a.year : null,
      studio: str(a.studio),
      directors: strings(a.directors).slice(0, 2),
      commonSenseAge: str(a.commonSenseAge),
      rottenTomatoes: str(a.rottenTomatoes),
      imdb: str(a.imdb),
      favorite: a.favorite === true,
    }))
    .filter((a) => a.title.length > 0);

  const directors = strings(t.directors);
  const writers = strings(t.writers);
  const studios = strings(t.studios);

  return {
    anchors,
    // Fall back to the legacy flat arrays when a stale client omits `taste`.
    directors: directors.length ? directors : legacy.directors,
    writers: writers.length ? writers : legacy.writers,
    studios: studios.length ? studios : legacy.studios,
    watchedCount:
      typeof t.watchedCount === 'number' && t.watchedCount > 0 ? t.watchedCount : 0,
  };
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
  const batchSize: number =
    typeof body.batchSize === 'number' && body.batchSize > 0
      ? Math.min(body.batchSize, 100)
      : 100;

  const taste = normalizeTaste(body.taste, {
    directors: filterStrings(body.directors),
    writers: filterStrings(body.writers),
    studios: filterStrings(body.studios),
  });

  const prompt = buildPrompt(poolTitles, libraryTitles, batchSize, taste);

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

    // Breadcrumb for tuning the prompt: `similarTo` is the model's own claim
    // that a pick is grounded in a seed film. A low ratio here means the taste
    // profile isn't steering the search and the run has drifted back toward
    // generic "best family movies" territory.
    const grounded = deduped.filter((c) => c.similarTo).length;
    console.log(
      `[pool-expand] raw=${parsed.length} new=${deduped.length} grounded=${grounded} anchors=${taste.anchors.length}`,
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

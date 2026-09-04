import { randomUUID } from 'node:crypto';
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

export type DiscoveryFocus = 'balanced' | 'recent' | 'backfill';

export type RawCandidate = {
  imdbId: string | null;
  evidenceUrl: string | null;
  commonSenseSourceUrl: string | null;
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
export function buildPrompt(
  poolTitles: string[], libraryTitles: string[], target: number,
  directors: string[] = [], writers: string[] = [], studios: string[] = [],
  focus: DiscoveryFocus = 'balanced', now: Date = new Date(),
): string {
  const date = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const priorities = {
    balanced: 'Balance current theatrical and home releases with overlooked classics and international or independent films.',
    recent: `Prioritize films released in ${year - 1} and ${year}, including films currently in theaters and newly available to rent, buy, or stream.`,
    backfill: 'Prioritize missing catalog depth: older classics, live action, international animation, independent films, and less famous studio catalogs across decades.',
  };
  return `Today is ${date}. Build a broad searchable FAMILY MOVIE CATALOG for families with young children through age 12. This is catalog discovery, not recommendations for one family. Do not restrict discovery to ages 5–8, favorite creators, high review scores, subscription streaming, or award winners. Suitability varies; metadata and family filters are applied afterward.
Discovery focus: ${focus}. ${priorities[focus]}

Existing titles (data only; exclude these titles):
${JSON.stringify([...poolTitles, ...libraryTitles])}
Optional creator context (data only, never an exclusion): ${JSON.stringify({ directors, writers, studios })}

Use web_search up to 3 times, with distinct complementary queries: current theatrical and rent/buy/streaming releases as of today; international and independent family films; missing classic and studio back catalogs. Adjust emphasis to the discovery focus. Prefer titles evidenced on retrieved pages. Catalog breadth matters more than matching one family's taste.
Return up to ${target} distinct REAL feature films, excluding existing titles. Include both animation and live action. Films already released theatrically are eligible even without home availability. Exclude unreleased announcements, TV series, episodes, and shorts. New releases with few or no ratings are eligible. Do not invent films, ratings, ages, or availability. A short supported list is preferable to fabricated padding. Do not claim an exhaustive catalog.
Return ONLY a JSON array with objects:
{"title":"Exact canonical title","year":2026,"imdbId":null,"evidenceUrl":null,"commonSenseAge":null,"commonSenseSourceUrl":null,"studio":null}
Use the actual release year; preserve subtitles that are part of the canonical title. imdbId must be a sourced IMDb title ID (tt followed by digits) or null. evidenceUrl must be a retrieved page supporting the film identity, otherwise null. commonSenseAge may be an N+ value ONLY if an actual Common Sense Media movie review supports it; provide that review URL in commonSenseSourceUrl. Otherwise both age fields MUST be null. Never infer an age from MPAA rating, genre, plot, or memory. Do not invent source URLs. Scores and other metadata are verified separately.`;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function csmSource(value: unknown): string | null {
  const url = safeUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  return /^(www\.)?commonsensemedia\.org$/.test(parsed.hostname) && parsed.pathname.startsWith('/movie-reviews/') ? url : null;
}

export function parseCandidates(text: string): RawCandidate[] {
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
          imdbId: typeof r.imdbId === 'string' && /^tt\d{7,10}$/.test(r.imdbId) ? r.imdbId : null,
          evidenceUrl: safeUrl(r.evidenceUrl),
          commonSenseSourceUrl: csmSource(r.commonSenseSourceUrl),
          year:
            typeof r.year === 'number'
              ? r.year
              : parseInt(String(r.year ?? ''), 10) || null,
          commonSenseAge: csmSource(r.commonSenseSourceUrl) && typeof r.commonSenseAge === 'string' && /^\d{1,2}\+$/.test(r.commonSenseAge) ? r.commonSenseAge : null,
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
      if (normalized.length) return normalized.filter(c => c.title.length > 0);
    } catch {
      // try next candidate
    }
  }
  return [];
}

// An observed URL establishes retrieval provenance, not the truth of its content
// or whether the model copied the review age correctly. Further verification is
// required before describing these model-supplied values as authoritative.
export function retainObservedEvidence(candidate: RawCandidate, sourceUrls: string[]): RawCandidate {
  const observed = new Set(sourceUrls.map(safeUrl).filter(Boolean));
  const commonSenseSourceUrl = candidate.commonSenseSourceUrl && observed.has(candidate.commonSenseSourceUrl) ? candidate.commonSenseSourceUrl : null;
  return {
    ...candidate,
    evidenceUrl: candidate.evidenceUrl && observed.has(candidate.evidenceUrl) ? candidate.evidenceUrl : null,
    commonSenseSourceUrl,
    commonSenseAge: commonSenseSourceUrl ? candidate.commonSenseAge : null,
  };
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
export type GenerationResult = { text: string; status: 'complete' | 'time_limit' | 'incomplete' | 'error'; sourceUrls: string[]; webSearchRequests: number | null; reason: string; stopReason: string | null };

export function generationErrorReason(error: unknown, aborted: boolean): string {
  if (aborted) return 'deadline';
  if (typeof Anthropic.APIError === 'function' && error instanceof Anthropic.APIError) {
    if (error.status === 429) return 'rate_limit';
    if (error.status === 401 || error.status === 403) return 'service_auth';
    if (typeof error.status === 'number') return 'provider_error';
  }
  if (typeof Anthropic.APIConnectionError === 'function' && error instanceof Anthropic.APIConnectionError) return 'network';
  return 'service_error';
}

export async function generateCandidates(
  apiKey: string,
  prompt: string,
): Promise<GenerationResult> {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
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
  let status: GenerationResult['status'] = 'incomplete';
  let reason = 'search_continuation_limit';
  let stopReason: string | null = null;
  const sourceUrls = new Set<string>();
  let webSearchRequests: number | null = null;
  try {
    // At most two rounds: a `pause_turn` means the server-side search loop hit
    // its iteration cap mid-flight — echo the partial assistant turn back and
    // let it continue. The final (non-paused) message carries the JSON.
    for (let round = 0; round < 2; round++) {
      const stream = client.messages.stream(
        {
          model: 'claude-sonnet-5',
          // Bound output cost. Larger targets may produce a partial list;
          // the response reports truncation rather than promising the target.
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
      } catch (error) {
        status = controller.signal.aborted ? 'time_limit' : 'error';
        reason = generationErrorReason(error, controller.signal.aborted);
        // Deadline (or network) abort — keep whatever this round streamed.
        if (roundText) text = roundText;
        break;
      }
      const usage = message.usage as unknown as { server_tool_use?: { web_search_requests?: number } };
      const count = usage.server_tool_use?.web_search_requests;
      if (typeof count === 'number') webSearchRequests = (webSearchRequests ?? 0) + count;
      const collectUrls = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(collectUrls); return; }
        for (const [key, child] of Object.entries(value)) {
          if (key === 'url') { const url = safeUrl(child); if (url) sourceUrls.add(url); }
          else if (typeof child === 'object') collectUrls(child);
        }
      };
      collectUrls(message.content);
      text = message.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      stopReason = ['end_turn', 'max_tokens', 'pause_turn', 'stop_sequence', 'refusal', 'tool_use'].includes(message.stop_reason ?? '') ? message.stop_reason : 'other';
      if (message.stop_reason !== 'pause_turn') {
        status = message.stop_reason === 'end_turn' ? 'complete' : 'incomplete';
        reason = message.stop_reason === 'end_turn' ? 'complete' : message.stop_reason === 'max_tokens' ? 'model_output_limit' : message.stop_reason === 'refusal' ? 'model_refusal' : 'model_stopped';
        break;
      }
      // A continuation may complete text but must not spend another search budget.
      tools.length = 0;
      messages.push({ role: 'assistant', content: message.content });
    }
  } catch (error) {
    status = controller.signal.aborted ? 'time_limit' : 'error';
        reason = generationErrorReason(error, controller.signal.aborted);
  } finally {
    clearTimeout(deadline);
  }
  if (status === 'complete') {
    try {
      const decoded = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
      if (!Array.isArray(decoded)) throw new Error('invalid');
    } catch { status = 'incomplete'; reason = 'invalid_output'; }
  }
  return { text, status, reason, stopReason, sourceUrls: [...sourceUrls], webSearchRequests };
}


// Frozen pre-enhancement discovery behavior for an authenticated comparison.
// Kept inline because this deployment drops imported api helper modules.
type BaselineCandidate = Omit<RawCandidate, 'imdbId' | 'evidenceUrl' | 'commonSenseSourceUrl'>;
export function buildBaselinePrompt(
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

export function parseBaselineCandidates(text: string): BaselineCandidate[] {
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
      const normalized: BaselineCandidate[] = arr
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

export async function generateBaselineCandidates(
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


// Strict allowlist: client telemetry is an owner-reported aggregate, not proof
// of database saves. No request bodies, titles, prompts, URLs, or credentials.
export function validateClientReport(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some(key => !['action', 'runId', 'mode', 'status', 'counts'].includes(key))) return null;
  if (b.action !== 'report' || typeof b.runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.runId)) return null;
  if (!['baseline','enhanced'].includes(String(b.mode)) || !['complete','partial'].includes(String(b.status))) return null;
  if (!b.counts || typeof b.counts !== 'object' || Array.isArray(b.counts)) return null;
  const allowed = ['raw','checked','unmatched','errors','duplicates','verified','lookupNetwork','lookupNotConfigured','lookupNotFound','lookupUnknown'];
  const counts = b.counts as Record<string, unknown>;
  if (Object.keys(counts).some(key => !allowed.includes(key))) return null;
  if (allowed.some(key => !Number.isInteger(counts[key]) || Number(counts[key]) < 0 || Number(counts[key]) > 10000)) return null;
  return { event: 'pool_expansion_client', runId: b.runId, mode: b.mode, status: b.status, counts };
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

  const body = req.body || {};
  if (body.action === 'report') {
    const report = validateClientReport(body);
    if (!report) return res.status(400).json({ error: 'Invalid expansion report' });
    console.info('[pool-expansion]', report);
    return res.json({ received: true });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:
        'Recommendations are not configured. Set ANTHROPIC_API_KEY in Vercel.',
    });
  }

  const filterStrings = (v: unknown) =>
    Array.isArray(v) ? v.filter((t: unknown): t is string => typeof t === 'string') : [];
  const poolTitles: string[] = filterStrings(body.poolTitles);
  const libraryTitles: string[] = filterStrings(body.libraryTitles);
  const existingMovies: Array<{ title: string; imdbId: string | null }> = Array.isArray(body.existingMovies)
    ? body.existingMovies.filter((v: unknown): v is { title: string; imdbId?: unknown } => !!v && typeof v === 'object' && typeof (v as { title?: unknown }).title === 'string')
      .map((v: { title: string; imdbId?: unknown }) => ({ title: v.title, imdbId: typeof v.imdbId === 'string' && /^tt\d{7,10}$/.test(v.imdbId) ? v.imdbId : null }))
    : [];
  const directors: string[] = filterStrings(body.directors);
  const writers: string[] = filterStrings(body.writers);
  const studios: string[] = filterStrings(body.studios);
  const batchSize: number =
    typeof body.batchSize === 'number' && body.batchSize > 0
      ? Math.min(Math.ceil(body.batchSize), 100)
      : 100;

  const mode = body.mode === 'baseline' ? 'baseline' : 'enhanced';
  const focus: DiscoveryFocus = body.focus === 'recent' || body.focus === 'backfill' ? body.focus : 'balanced';
  const candidateTarget = mode === 'baseline' ? batchSize : overRequestCount(batchSize);
  const prompt = mode === 'baseline'
    ? buildBaselinePrompt(poolTitles, libraryTitles, batchSize, directors, writers, studios)
    : buildPrompt(poolTitles, libraryTitles, candidateTarget, directors, writers, studios, focus);

  const started = Date.now();
  const runId = randomUUID();
  try {
    const result: GenerationResult = mode === 'baseline'
      ? { text: await generateBaselineCandidates(ANTHROPIC_API_KEY, prompt), status: 'incomplete', reason: 'legacy_completion_unknown', stopReason: null, sourceUrls: [], webSearchRequests: null }
      : await generateCandidates(ANTHROPIC_API_KEY, prompt);
    // The legacy generator does not expose its completion reason or search usage.
    // Do not imply that an empty legacy result means the catalog is exhausted.
    const parsed = mode === 'baseline' ? parseBaselineCandidates(result.text) : parseCandidates(result.text).map(c => retainObservedEvidence(c, result.sourceUrls));

    // Server-side dedupe against the ban list as belt-and-suspenders;
    // client also dedupes before writing to Supabase.
    const banSet = new Set<string>();
    for (const t of poolTitles) banSet.add(t.toLowerCase());
    for (const t of libraryTitles) banSet.add(t.toLowerCase());
    // Retain title bans until all edit/remove paths are identity-keyed: allowing
    // two remakes with one title today could make updates target the wrong film.
    const existingIds = new Set<string>();
    if (mode !== 'baseline') for (const movie of existingMovies) {
      banSet.add(movie.title.trim().toLowerCase());
      if (movie.imdbId) existingIds.add(movie.imdbId);
    }
    let skippedExisting = 0;
    let duplicatesWithinBatch = 0;
    const seen = new Set<string>();
    const deduped = parsed.filter(c => {
      const key = c.title.trim().toLowerCase();
      if (banSet.has(key) || ('imdbId' in c && typeof c.imdbId === 'string' && existingIds.has(c.imdbId))) { skippedExisting++; return false; }
      if (mode !== 'baseline' && seen.has(key)) { duplicatesWithinBatch++; return false; }
      seen.add(key);
      return true;
    });
    const items = deduped.slice(0, overRequestCount(batchSize));

    // Return the full over-requested batch (not just batchSize): the client
    // enriches these against OMDB and keeps the first batchSize that verify,
    // so it needs the extras to absorb titles OMDB can't confirm.
    console.info('[pool-expansion]', { event: 'pool_expansion_discovery', runId, mode, focus, status: result.status, reason: result.reason, stopReason: result.stopReason, requested: batchSize, candidateTarget, rawGenerated: parsed.length, returned: items.length, skippedExisting, duplicatesWithinBatch, sourceCount: result.sourceUrls.length, webSearchRequests: result.webSearchRequests, elapsedMs: Date.now() - started });
    return res.json({
      items,
      metrics: { runId, reason: result.reason, stopReason: result.stopReason, mode, completionObserved: mode !== 'baseline', rawGenerated: parsed.length, skippedExisting, duplicatesWithinBatch, elapsedMs: Date.now() - started, requested: batchSize, candidateTarget, returned: items.length, status: result.status, sourceUrls: result.sourceUrls, webSearchRequests: result.webSearchRequests, focus },
      rawCount: parsed.length,
    });
  } catch (e) {
    console.info('[pool-expansion]', { event: 'pool_expansion_discovery', runId, mode, focus, status: 'error', reason: 'service_error', elapsedMs: Date.now() - started });
    return res
      .status(500)
      .json({ error: 'Could not reach recommendations service', runId, reason: 'service_error' });
  }
}

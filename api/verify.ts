import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Owner-only: this endpoint powers the "Ask Claude to verify" textbox on the
// Detail page, which is intentionally single-user. Alexandra can write to the
// list, but kicking off ad-hoc Anthropic calls from a textbox is Zach's
// admin tool.
const OWNER_EMAIL = 'zachtjohnson01@gmail.com';

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
  if (email !== OWNER_EMAIL) {
    return {
      ok: false,
      status: 403,
      error: 'Not authorized to verify movie fields',
    };
  }
  return { ok: true, email };
}

type MovieSnapshot = {
  title: string;
  year: number | null;
  imdbId: string | null;
  production: string | null;
  awards: string | null;
  commonSenseAge: string | null;
};

type VerifyField = 'production' | 'awards' | 'year' | 'commonSenseAge';

type VerifyResult = {
  field: VerifyField | null;
  currentValue: string | null;
  suggestedValue: string | null;
  matches: boolean;
  explanation: string;
};

function buildPrompt(movie: MovieSnapshot, question: string): string {
  const yearStr = movie.year ? ` (${movie.year})` : '';
  const id = movie.imdbId ? ` [${movie.imdbId}]` : '';
  return `You are verifying a single field for a movie the user has stored in a personal tracker.

MOVIE: ${movie.title}${yearStr}${id}

CURRENT VALUES:
- production (studio): ${movie.production ?? '(blank)'}
- awards: ${movie.awards ?? '(blank)'}
- year: ${movie.year ?? '(blank)'}
- commonSenseAge: ${movie.commonSenseAge ?? '(blank)'}

USER QUESTION: ${question}

Decide which single field the question is asking about, then answer for that field. Only these fields are verifiable: "production", "awards", "year", "commonSenseAge". If the question doesn't map to one of those fields, return field: null.

Return ONLY a JSON object. No prose, no code fences. Shape:
{"field": "production"|"awards"|"year"|"commonSenseAge"|null, "currentValue": "<echo the stored value as a string, or null if blank>", "suggestedValue": "<your answer as a string, or null if you aren't confident>", "matches": <true|false>, "explanation": "<one or two sentences explaining your answer>"}

RULES:

- "production": lead production company (e.g. "Pixar Animation Studios", "Studio Ghibli", "Walt Disney Pictures"). Prefer the primary studio, not the distributor.

- "awards": ONLY include awards if you are HIGHLY confident the film actually won or was seriously nominated for a major award — Academy Awards (Oscars), BAFTAs, Golden Globes, Cannes, Annies, or Critics' Choice. Format when non-empty: "Won 1 Oscar. 14 wins & 13 nominations." If you aren't sure, set suggestedValue to null. Empty (null) is strongly preferred over a guess.

- "year": four-digit release year as a string, e.g. "1999".

- "commonSenseAge": Common Sense Media's age rating, like "6+", "8+", "10+". If you don't know Common Sense Media's specific rating, set suggestedValue to null — do NOT substitute MPAA ratings (G, PG, etc).

- "matches": true if your suggestedValue is semantically the same as the currentValue (case-insensitive, whitespace-trimmed, "N/A" counts as blank). Otherwise false. If suggestedValue is null, matches must be false.

- When the user's question is unrelated to any of the four fields, return {"field": null, "currentValue": null, "suggestedValue": null, "matches": false, "explanation": "<brief note>"}.

- When the bracketed "[tt...]" IMDb ID is present, use it to disambiguate films that share a title.`;
}

function parseResult(text: string): VerifyResult | null {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rawField = r.field;
  const field: VerifyField | null =
    rawField === 'production' ||
    rawField === 'awards' ||
    rawField === 'year' ||
    rawField === 'commonSenseAge'
      ? rawField
      : null;
  const asStr = (v: unknown): string | null => {
    if (typeof v === 'string') {
      const s = v.trim();
      return s && s.toLowerCase() !== 'n/a' ? s : null;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  };
  return {
    field,
    currentValue: asStr(r.currentValue),
    suggestedValue: asStr(r.suggestedValue),
    matches: r.matches === true,
    explanation:
      typeof r.explanation === 'string' ? r.explanation.trim() : '',
  };
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
      error: 'Verification is not configured. Set ANTHROPIC_API_KEY in Vercel.',
    });
  }

  const body = req.body || {};
  const rawMovie = body.movie;
  const rawQuestion = body.question;
  if (
    !rawMovie ||
    typeof rawMovie !== 'object' ||
    typeof (rawMovie as Record<string, unknown>).title !== 'string'
  ) {
    return res.status(400).json({ error: 'Missing movie' });
  }
  if (typeof rawQuestion !== 'string' || !rawQuestion.trim()) {
    return res.status(400).json({ error: 'Missing question' });
  }
  const m = rawMovie as Record<string, unknown>;
  const movie: MovieSnapshot = {
    title: String(m.title).trim(),
    year: typeof m.year === 'number' ? m.year : null,
    imdbId: typeof m.imdbId === 'string' ? m.imdbId : null,
    production: typeof m.production === 'string' ? m.production : null,
    awards: typeof m.awards === 'string' ? m.awards : null,
    commonSenseAge:
      typeof m.commonSenseAge === 'string' ? m.commonSenseAge : null,
  };
  const question = rawQuestion.trim().slice(0, 500);

  const prompt = buildPrompt(movie, question);

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
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '(no body)');
      console.error('[verify] anthropic error', resp.status, errText);
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
    const parsed = parseResult(text);
    if (!parsed) {
      return res.status(502).json({
        error: 'Could not parse verification response',
      });
    }

    return res.json({ result: parsed });
  } catch (e) {
    console.error('[verify] fetch error', e);
    return res
      .status(500)
      .json({ error: 'Could not reach verification service' });
  }
}

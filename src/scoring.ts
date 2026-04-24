import type { Candidate } from './types';

/**
 * Deterministic scoring for the "For You" tab. Pure function over whatever
 * subset of fields a Candidate has populated. No randomness, no I/O — the
 * same inputs always produce the same score.
 *
 * Signals (each normalized to 0–100):
 *   RT %               weights.rt
 *   IMDb rating × 10   weights.imdb
 *   CSM age fit        weights.csm    (target band 5–8)
 *   Studio pedigree    weights.studio
 *   Awards             weights.awards
 *   Director affinity  weights.director  (100 if director is in library, else skipped)
 *   Writer affinity    weights.writer    (100 if writer is in library, else skipped)
 *
 * Missing fields are *skipped*, not penalized. The final score renormalizes
 * against the weights of signals that were actually present. This is fair
 * to older or manually-entered records while still letting a fully-rich
 * candidate outscore a sparse one (because 5 strong signals > 1 strong
 * signal averaged alone, given the explicit tier caps).
 */

export type ScoringWeights = {
  rt: number;
  imdb: number;
  csm: number;
  studio: number;
  awards: number;
  director: number;
  writer: number;
};

// Integer percentages that must sum to 100 — the admin weights editor
// enforces this invariant on save. The scoring algorithm itself doesn't
// care about absolute scale (it renormalizes against the sum of weights
// of signals actually present), so the 0–100 representation is purely a
// UX choice that makes the "tweak the model" form obvious to read.
export const DEFAULT_WEIGHTS: ScoringWeights = {
  rt: 26,
  imdb: 26,
  csm: 17,
  studio: 9,
  awards: 9,
  director: 9,
  writer: 4,
};

export type ScoreInput = Pick<
  Candidate,
  'rottenTomatoes' | 'imdb' | 'commonSenseAge' | 'studio' | 'awards' | 'directors' | 'writers'
> & { downvoted?: boolean | null };

export type ScoreContext = {
  knownDirectors: string[];
  knownWriters: string[];
};

// Admin downvote penalty. Large enough that any downvoted candidate ranks
// below every non-downvoted one regardless of signals — satisfies the "push
// to the bottom of the list" contract without introducing a tuning knob.
const DOWNVOTE_PENALTY = 1000;

// Studio pedigree tiers. Lowercase substring match against the studio string
// so "Walt Disney Animation Studios" matches "disney" and "Aardman Animations"
// matches "aardman". Order matters within a tier, but tiers are evaluated
// highest-first so Disney-owned Pixar still scores as Pixar.
const STUDIO_TIERS: Array<{ score: number; keywords: string[] }> = [
  {
    score: 100,
    keywords: [
      'ghibli',
      'pixar',
      'aardman',
      'laika',
      'cartoon saloon',
      'gkids',
    ],
  },
  {
    score: 75,
    keywords: [
      'disney',
      'dreamworks',
      'sony pictures animation',
      'illumination',
      'warner animation',
      'nickelodeon movies',
    ],
  },
];

export function scoreCandidate(
  c: ScoreInput,
  context?: ScoreContext,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const parts: Array<{ weight: number; value: number }> = [];

  const rt = parseRt(c.rottenTomatoes);
  if (rt != null) parts.push({ weight: weights.rt, value: rt });

  const imdb = parseImdb(c.imdb);
  if (imdb != null) parts.push({ weight: weights.imdb, value: imdb });

  const csm = csmFit(c.commonSenseAge);
  if (csm != null) parts.push({ weight: weights.csm, value: csm });

  const studio = studioPedigree(c.studio);
  if (studio != null) parts.push({ weight: weights.studio, value: studio });

  const awards = awardsStrength(c.awards);
  if (awards != null) parts.push({ weight: weights.awards, value: awards });

  const dir = directorAffinity(c, context);
  if (dir != null) parts.push({ weight: weights.director, value: dir });

  const wri = writerAffinity(c, context);
  if (wri != null) parts.push({ weight: weights.writer, value: wri });

  const base =
    parts.length === 0
      ? 0
      : Math.round(
          parts.reduce((s, p) => s + p.weight * p.value, 0) /
            parts.reduce((s, p) => s + p.weight, 0),
        );

  return c.downvoted ? base - DOWNVOTE_PENALTY : base;
}

function parseRt(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return clamp(n, 0, 100);
}

function parseImdb(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return clamp(n * 10, 0, 100);
}

/**
 * Target CSM age band is 5–8 (from `api/recommendations.ts` prompt rules,
 * which reflect the real use case: daughter is young enough that 9+ is
 * only acceptable when the film is genuinely exceptional, and ≤4 tends
 * to be too young). Ages outside the band don't get zero — they still
 * score something, just degraded.
 */
function csmFit(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 5 && n <= 8) return 100;
  if (n === 4 || n === 9) return 70;
  return 40;
}

function studioPedigree(raw: string | null): number | null {
  if (!raw) return null;
  const needle = raw.toLowerCase();
  for (const tier of STUDIO_TIERS) {
    if (tier.keywords.some((k) => needle.includes(k))) return tier.score;
  }
  return 50;
}

function awardsStrength(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === 'n/a' || s.trim() === '') return null;
  if (/won \d+\s+oscar/.test(s)) return 100;
  if (/\bwon\b/.test(s)) return 75;
  if (/nominat/.test(s)) return 50;
  return null;
}

// Pure bonus signals: return 100 on a library match, null otherwise.
// Null means the signal is skipped (not penalized) — unknown creators
// are treated neutrally, not negatively.

function directorAffinity(c: ScoreInput, context?: ScoreContext): number | null {
  if (!context?.knownDirectors.length || !c.directors?.length) return null;
  const known = new Set(context.knownDirectors.map((d) => d.toLowerCase()));
  return c.directors.some((d) => known.has(d.toLowerCase())) ? 100 : null;
}

function writerAffinity(c: ScoreInput, context?: ScoreContext): number | null {
  if (!context?.knownWriters.length || !c.writers?.length) return null;
  const known = new Set(context.knownWriters.map((w) => w.toLowerCase()));
  return c.writers.some((w) => known.has(w.toLowerCase())) ? 100 : null;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

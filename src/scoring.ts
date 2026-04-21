import type { Candidate } from './types';

/**
 * Deterministic scoring for the "For You" tab. Pure function over whatever
 * subset of fields a Candidate has populated. No randomness, no I/O — the
 * same inputs always produce the same score.
 *
 * Signals (each normalized to 0–100):
 *   RT %               0.30
 *   IMDb rating × 10   0.30
 *   CSM age fit        0.20   (target band 5–8, per Friday-movie-night use case)
 *   Studio pedigree    0.10
 *   Awards             0.10
 *
 * Missing fields are *skipped*, not penalized. The final score renormalizes
 * against the weights of signals that were actually present. This is fair
 * to older or manually-entered records while still letting a fully-rich
 * candidate outscore a sparse one (because 5 strong signals > 1 strong
 * signal averaged alone, given the explicit tier caps).
 */

export type ScoreInput = Pick<
  Candidate,
  'rottenTomatoes' | 'imdb' | 'commonSenseAge' | 'studio' | 'awards'
>;

type SignalKey = 'rt' | 'imdb' | 'csm' | 'studio' | 'awards';

const WEIGHTS: Record<SignalKey, number> = {
  rt: 0.3,
  imdb: 0.3,
  csm: 0.2,
  studio: 0.1,
  awards: 0.1,
};

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

export function scoreCandidate(c: ScoreInput): number {
  const parts: Array<{ weight: number; value: number }> = [];

  const rt = parseRt(c.rottenTomatoes);
  if (rt != null) parts.push({ weight: WEIGHTS.rt, value: rt });

  const imdb = parseImdb(c.imdb);
  if (imdb != null) parts.push({ weight: WEIGHTS.imdb, value: imdb });

  const csm = csmFit(c.commonSenseAge);
  if (csm != null) parts.push({ weight: WEIGHTS.csm, value: csm });

  const studio = studioPedigree(c.studio);
  if (studio != null) parts.push({ weight: WEIGHTS.studio, value: studio });

  const awards = awardsStrength(c.awards);
  if (awards != null) parts.push({ weight: WEIGHTS.awards, value: awards });

  if (parts.length === 0) return 0;

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.weight * p.value, 0);
  return Math.round(weighted / totalWeight);
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

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

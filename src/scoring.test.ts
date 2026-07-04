import { describe, expect, it } from 'vitest';
import { scoreCandidate, type ScoreContext, type ScoreInput } from './scoring';

function base(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    rottenTomatoes: null,
    imdb: null,
    commonSenseAge: null,
    studio: null,
    awards: null,
    directors: null,
    writers: null,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('returns 0 when no signals are present', () => {
    expect(scoreCandidate(base())).toBe(0);
  });

  it('a single RT signal renormalizes to the RT value', () => {
    expect(scoreCandidate(base({ rottenTomatoes: '90%' }))).toBe(90);
  });

  it('parses IMDb as rating x10 and clamps to 100', () => {
    expect(scoreCandidate(base({ imdb: '7.5' }))).toBe(75);
    expect(scoreCandidate(base({ imdb: '11' }))).toBe(100);
  });

  it('scores CSM age: in-band (5-8) 100, edge (4/9) 70, outside 40', () => {
    expect(scoreCandidate(base({ commonSenseAge: '6' }))).toBe(100);
    expect(scoreCandidate(base({ commonSenseAge: '9' }))).toBe(70);
    expect(scoreCandidate(base({ commonSenseAge: '13' }))).toBe(40);
  });

  it('scores studio pedigree by tier', () => {
    expect(scoreCandidate(base({ studio: 'Pixar Animation Studios' }))).toBe(100);
    expect(scoreCandidate(base({ studio: 'Walt Disney Pictures' }))).toBe(75);
    expect(scoreCandidate(base({ studio: 'Some Indie Co' }))).toBe(50);
  });

  it('scores awards and skips N/A', () => {
    expect(scoreCandidate(base({ awards: 'Won 1 Oscar. 3 wins.' }))).toBe(100);
    expect(scoreCandidate(base({ awards: 'Won 2 BAFTAs' }))).toBe(75);
    expect(scoreCandidate(base({ awards: 'Nominated for 3 Annie Awards' }))).toBe(50);
    // N/A is skipped, leaving no signals → 0
    expect(scoreCandidate(base({ awards: 'N/A' }))).toBe(0);
  });

  it('counts director/writer affinity only for known creators', () => {
    const ctx: ScoreContext = { knownDirectors: ['Brad Bird'], knownWriters: [] };
    expect(scoreCandidate(base({ directors: ['Brad Bird'] }), ctx)).toBe(100);
    // unknown director is skipped, not penalized → no signals → 0
    expect(scoreCandidate(base({ directors: ['Nobody Known'] }), ctx)).toBe(0);
  });

  it('pushes downvoted candidates below every non-downvoted one', () => {
    const weakButKept = scoreCandidate(base({ rottenTomatoes: '10%' }));
    const strongButDownvoted = scoreCandidate(
      base({ rottenTomatoes: '100%', downvoted: true }),
    );
    expect(strongButDownvoted).toBeLessThan(weakButKept);
    expect(strongButDownvoted).toBeLessThan(0);
  });

  it('renormalizes as a weighted average across present signals', () => {
    // RT 100 and IMDb 0 carry equal weight → lands in between, not 100.
    const s = scoreCandidate(base({ rottenTomatoes: '100%', imdb: '0' }));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });
});

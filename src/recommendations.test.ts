import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));
// Keep the real normalizeTitle/dedupKey (used by rankTopPicks etc.); only
// stub the network-bound OMDB enrichment.
vi.mock('./omdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./omdb')>();
  return { ...actual, enrichCandidate: vi.fn() };
});

import {
  countEffectiveCandidates,
  expandPool,
  extractUnique,
  rankTopPicks,
  type ExpandProgress,
} from './recommendations';
import { enrichCandidate, type CandidateOmdbPatch } from './omdb';
import { emptyMovie } from './format';
import type { Candidate, Movie } from './types';

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    title: 'Movie',
    year: 2020,
    imdbId: null,
    imdb: '8.0',
    rottenTomatoes: '90%',
    commonSenseAge: '6',
    studio: null,
    awards: null,
    poster: null,
    addedAt: '2026-01-01T00:00:00Z',
    directors: null,
    writers: null,
    ...over,
  };
}

function watched(title: string, imdbId: string | null): Movie {
  return { ...emptyMovie(true), title, imdbId };
}

describe('extractUnique', () => {
  it('trims, drops blanks and N/A, dedupes, and sorts', () => {
    expect(
      extractUnique(['Bob', ' Bob ', null, 'N/A', 'Alice', '', undefined]),
    ).toEqual(['Alice', 'Bob']);
  });
});

describe('rankTopPicks', () => {
  const library = [watched('Owned', 'tt-owned')];

  it('excludes candidates already in the library by imdbId', () => {
    const picks = rankTopPicks(
      [cand({ title: 'Different name', imdbId: 'tt-owned' })],
      library,
    );
    expect(picks).toHaveLength(0);
  });

  it('excludes candidates already in the library by normalized title', () => {
    const picks = rankTopPicks(
      [cand({ title: 'owned', imdbId: 'tt-x' })],
      library,
    );
    expect(picks).toHaveLength(0);
  });

  it('drops candidates with no RT or IMDb signal', () => {
    const picks = rankTopPicks(
      [cand({ title: 'NoSignal', imdbId: 'tt1', rottenTomatoes: null, imdb: null })],
      [],
    );
    expect(picks).toHaveLength(0);
  });

  it('drops soft-removed candidates', () => {
    const picks = rankTopPicks(
      [cand({ title: 'Removed', imdbId: 'tt2', removedReason: 'duplicate' })],
      [],
    );
    expect(picks).toHaveLength(0);
  });

  it('ranks by fit score descending', () => {
    const picks = rankTopPicks(
      [
        cand({ title: 'Low', imdbId: 'ttL', rottenTomatoes: '20%', imdb: '2.0' }),
        cand({ title: 'High', imdbId: 'ttH', rottenTomatoes: '99%', imdb: '9.0' }),
      ],
      [],
    );
    expect(picks.map((p) => p.title)).toEqual(['High', 'Low']);
    expect(picks[0].fitScore).toBeGreaterThan(picks[1].fitScore);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      cand({ title: `M${i}`, imdbId: `tt${i}` }),
    );
    expect(rankTopPicks(many, [], 2)).toHaveLength(2);
  });

  it('breaks score ties by original insertion order (stable)', () => {
    const picks = rankTopPicks(
      [cand({ title: 'A', imdbId: 'ttA' }), cand({ title: 'B', imdbId: 'ttB' })],
      [],
    );
    expect(picks.map((p) => p.title)).toEqual(['A', 'B']);
  });
});

describe('countEffectiveCandidates', () => {
  it('counts only linked, movie-type, rated, non-removed, non-duplicate rows', () => {
    const list = [
      cand({ title: 'Good', imdbId: 'tt1' }),
      cand({ title: 'NoId', imdbId: null }),
      cand({ title: 'Removed', imdbId: 'tt2', removedAt: '2026-01-01T00:00:00Z' }),
      cand({ title: 'Series', imdbId: 'tt3', type: 'series' }),
      cand({ title: 'NoRating', imdbId: 'tt4', rottenTomatoes: null, imdb: null }),
    ];
    expect(countEffectiveCandidates(list)).toBe(1);
  });

  it('excludes duplicate-title candidates from the count', () => {
    const dupes = [
      cand({ title: 'Dup', imdbId: 'tt1' }),
      cand({ title: 'Dup', imdbId: 'tt2' }),
    ];
    expect(countEffectiveCandidates(dupes)).toBe(0);
  });
});

describe('expandPool', () => {
  const omdbPatch = (title: string): CandidateOmdbPatch => ({
    imdbId: `tt-${title}`,
    year: 2020,
    imdb: '8.0',
    rottenTomatoes: '90%',
    poster: null,
    awards: null,
    production: null,
    directors: null,
    writers: null,
    type: 'movie',
  });

  const stubApiTitles = (titles: string[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: titles.map((t) => ({
            title: t,
            year: 2020,
            commonSenseAge: '6+',
            studio: null,
            awards: null,
            director: null,
            writer: null,
            rottenTomatoes: null,
            imdb: null,
          })),
        }),
      }),
    );
  };

  beforeEach(() => {
    vi.mocked(enrichCandidate).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enriches OMDB with bounded concurrency (never all at once)', async () => {
    stubApiTitles(Array.from({ length: 30 }, (_, i) => `M${i}`));
    let active = 0;
    let maxActive = 0;
    vi.mocked(enrichCandidate).mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return omdbPatch('x');
    });

    await expandPool([], [], 100);

    // The whole point of the fix: OMDB is hit a few at a time, not in a
    // ~30-wide burst that trips the free-tier rate limiter.
    expect(maxActive).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('keeps only OMDB-verified titles and drops the rest', async () => {
    stubApiTitles(['Good', 'Bad', 'Good2']);
    vi.mocked(enrichCandidate).mockImplementation(async (t: string) =>
      t.startsWith('Good') ? omdbPatch(t) : null,
    );

    const out = await expandPool([], [], 100);
    expect(out.map((c) => c.title).sort()).toEqual(['Good', 'Good2']);
    expect(out[0].imdbId).toBe('tt-Good');
  });

  it('stops after batchSize survivors and never re-adds pool titles', async () => {
    stubApiTitles(['Owned', ...Array.from({ length: 20 }, (_, i) => `M${i}`)]);
    vi.mocked(enrichCandidate).mockImplementation(async () => omdbPatch('x'));

    const out = await expandPool(['Owned'], [], 5);
    expect(out).toHaveLength(5);
    expect(out.map((c) => c.title)).not.toContain('Owned');
    // Early-stop: does not enrich all 21 titles once 5 have verified.
    expect(vi.mocked(enrichCandidate).mock.calls.length).toBeLessThan(20);
    // A pool title is filtered before it ever costs an OMDB lookup.
    expect(enrichCandidate).not.toHaveBeenCalledWith('Owned');
  });

  it('reports progress stages ending in done', async () => {
    stubApiTitles(['A', 'B']);
    vi.mocked(enrichCandidate).mockImplementation(async () => omdbPatch('x'));
    const events: ExpandProgress[] = [];

    await expandPool([], [], 100, undefined, (p) => events.push(p));

    expect(events[0]).toEqual({ stage: 'requesting' });
    expect(events.some((e) => e.stage === 'enriching')).toBe(true);
    expect(events[events.length - 1]).toEqual({ stage: 'done', added: 2 });
  });
});

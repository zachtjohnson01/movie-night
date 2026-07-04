import { describe, expect, it } from 'vitest';
import {
  countEffectiveCandidates,
  extractUnique,
  rankTopPicks,
} from './recommendations';
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

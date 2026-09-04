import { describe, expect, it } from 'vitest';
import { filterNewCandidates } from './useCandidatePool';
import type { Candidate } from './types';

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    title: 'Movie',
    year: 2020,
    imdbId: null,
    imdb: '8.0',
    rottenTomatoes: '90%',
    commonSenseAge: '6+',
    studio: null,
    awards: null,
    poster: null,
    addedAt: '2026-01-01T00:00:00Z',
    directors: null,
    writers: null,
    ...over,
  };
}

describe('filterNewCandidates', () => {
  it('drops a candidate that shares an imdbId with the pool even if the title differs', () => {
    // The real bug: two "Puffin Rock" rows, same tt-id, slightly different title.
    const existing = [
      cand({ title: 'Puffin Rock and the New Friends', imdbId: 'tt15380052' }),
    ];
    const next = [
      cand({ title: 'Puffin Rock & the New Friends', imdbId: 'tt15380052' }),
    ];
    expect(filterNewCandidates(existing, next)).toEqual([]);
  });

  it('matches imdbId case-insensitively', () => {
    const existing = [cand({ title: 'A', imdbId: 'TT1' })];
    const next = [cand({ title: 'B', imdbId: 'tt1' })];
    expect(filterNewCandidates(existing, next)).toEqual([]);
  });

  it('still dedupes by title when imdbIds are absent', () => {
    const existing = [cand({ title: 'Coco', imdbId: null })];
    const next = [cand({ title: 'coco', imdbId: null })];
    expect(filterNewCandidates(existing, next)).toEqual([]);
  });

  it('dedupes within the incoming batch by imdbId', () => {
    const next = [
      cand({ title: 'Up', imdbId: 'tt1049413' }),
      cand({ title: 'Up (2009)', imdbId: 'tt1049413' }),
    ];
    const out = filterNewCandidates([], next);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Up');
  });

  it('dedupes unlinked titles within a batch', () => {
    expect(filterNewCandidates([], [cand({ title: 'New' }), cand({ title: 'new' })])).toHaveLength(1);
  });

  it('keeps genuinely new candidates', () => {
    const existing = [cand({ title: 'Owned', imdbId: 'tt-owned' })];
    const next = [
      cand({ title: 'Fresh One', imdbId: 'tt-fresh' }),
      cand({ title: 'Owned', imdbId: 'tt-owned' }), // dup
    ];
    const out = filterNewCandidates(existing, next);
    expect(out.map((c) => c.title)).toEqual(['Fresh One']);
  });
});

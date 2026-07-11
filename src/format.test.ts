import { describe, expect, it } from 'vitest';
import {
  coerceCreatorLists,
  computeCrossovers,
  earliestWatched,
  emptyMovie,
  formatDate,
  formatRtScore,
  getDisplayTitle,
  needsEnhance,
  parseNameList,
  sortWatched,
} from './format';
import type { Movie } from './types';

function movie(over: Partial<Movie> = {}): Movie {
  return { ...emptyMovie(false), ...over };
}

describe('needsEnhance', () => {
  const complete = {
    production: 'Pixar',
    awards: 'Won 1 Oscar.',
    directors: ['A'],
    writers: ['B'],
  };

  it('counts a never-enhanced movie missing any enrichable field', () => {
    expect(needsEnhance(movie({ ...complete, production: null }))).toBe(true);
    expect(needsEnhance(movie({ ...complete, awards: null }))).toBe(true);
    expect(needsEnhance(movie({ ...complete, directors: null }))).toBe(true);
    expect(needsEnhance(movie({ ...complete, writers: null }))).toBe(true);
  });

  it('does not count a movie with every field already filled', () => {
    expect(needsEnhance(movie(complete))).toBe(false);
  });

  it('stops counting once a movie has been through an enrich pass', () => {
    // A movie whose remaining nulls are terminal (no awards, no studio to
    // fetch) must not be re-advertised after it has been tried — this is
    // the fix for the badge over-promising updates it can't deliver.
    const tried = movie({
      production: null,
      awards: null,
      directors: null,
      writers: null,
      enrichedAt: '2026-07-11T00:00:00.000Z',
    });
    expect(needsEnhance(tried)).toBe(false);
  });
});

describe('formatRtScore', () => {
  it('appends % to a bare integer', () => {
    expect(formatRtScore('84')).toBe('84%');
  });
  it('rounds a decimal before appending %', () => {
    expect(formatRtScore('84.6')).toBe('85%');
  });
  it('clamps values above 100', () => {
    expect(formatRtScore('840')).toBe('100%');
  });
  it('leaves an already-formatted percent untouched', () => {
    expect(formatRtScore('84%')).toBe('84%');
  });
  it('trims surrounding whitespace', () => {
    expect(formatRtScore('  91  ')).toBe('91%');
  });
  it('collapses blank / null to null', () => {
    expect(formatRtScore('   ')).toBeNull();
    expect(formatRtScore('')).toBeNull();
    expect(formatRtScore(null)).toBeNull();
  });
  it('passes through non-numeric strings unchanged', () => {
    expect(formatRtScore('Fresh')).toBe('Fresh');
  });
});

describe('formatDate (timezone-safe)', () => {
  it('formats a pure-date string without any timezone shift', () => {
    // The whole point: "2024-12-06" must render as Dec 6 in every timezone,
    // never Dec 5 (which `new Date("2024-12-06")` would produce in the US).
    expect(formatDate('2024-12-06')).toBe('Dec 6, 2024');
    expect(formatDate('2025-01-01')).toBe('Jan 1, 2025');
  });
  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });
  it('passes through a value it cannot parse', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('parseNameList', () => {
  it('splits a comma-separated string, trimming and dropping N/A', () => {
    expect(parseNameList('Brad Bird, N/A , Pete Docter')).toEqual([
      'Brad Bird',
      'Pete Docter',
    ]);
  });
  it('filters an array to valid names', () => {
    expect(parseNameList(['A', '', 'N/A', 'B'])).toEqual(['A', 'B']);
  });
  it('returns null when nothing valid remains', () => {
    expect(parseNameList('N/A')).toBeNull();
    expect(parseNameList(null)).toBeNull();
    expect(parseNameList(42)).toBeNull();
  });
});

describe('coerceCreatorLists', () => {
  it('promotes legacy `director`/`writer` strings to arrays and drops them', () => {
    const raw = { title: 'X', director: 'A, B', writer: 'C' } as Record<
      string,
      unknown
    >;
    const out = coerceCreatorLists(raw) as Record<string, unknown>;
    expect(out.directors).toEqual(['A', 'B']);
    expect(out.writers).toEqual(['C']);
    expect('director' in out).toBe(false);
    expect('writer' in out).toBe(false);
  });
  it('leaves existing array fields intact', () => {
    const out = coerceCreatorLists({ directors: ['A'], writers: ['B'] }) as Record<
      string,
      unknown
    >;
    expect(out.directors).toEqual(['A']);
    expect(out.writers).toEqual(['B']);
  });
});

describe('getDisplayTitle', () => {
  it('prefers displayTitle when set', () => {
    expect(
      getDisplayTitle({ title: 'Original', displayTitle: 'English Name' }),
    ).toBe('English Name');
  });
  it('falls back to the canonical title', () => {
    expect(getDisplayTitle({ title: 'Bolt', displayTitle: null })).toBe('Bolt');
    expect(getDisplayTitle({ title: 'Bolt', displayTitle: '  ' })).toBe('Bolt');
  });
});

describe('earliestWatched', () => {
  it('returns the earliest known dateWatched, ignoring nulls', () => {
    const list = [
      movie({ dateWatched: '2025-03-01' }),
      movie({ dateWatched: null }),
      movie({ dateWatched: '2024-11-15' }),
    ];
    expect(earliestWatched(list)).toBe('2024-11-15');
  });
  it('returns null when no movie has a date', () => {
    expect(earliestWatched([movie({ dateWatched: null })])).toBeNull();
  });
});

describe('sortWatched', () => {
  it('sorts dated movies newest-first with undated last', () => {
    const sorted = sortWatched([
      movie({ title: 'Undated', dateWatched: null }),
      movie({ title: 'Old', dateWatched: '2024-01-01' }),
      movie({ title: 'New', dateWatched: '2025-06-01' }),
    ]);
    expect(sorted.map((m) => m.title)).toEqual(['New', 'Old', 'Undated']);
  });
});

describe('computeCrossovers', () => {
  const library: Movie[] = [
    movie({ title: 'Finding Nemo', watched: true, imdbId: 'tt-nemo', directors: ['Andrew Stanton'], production: 'Pixar' }),
    movie({ title: 'A Bugs Life', watched: true, imdbId: 'tt-bug', directors: ['John Lasseter'], production: 'Pixar' }),
    // A wishlist (unwatched) movie by the same director must NOT be a match.
    movie({ title: 'Onward', watched: false, imdbId: 'tt-onward', directors: ['Andrew Stanton'], production: 'Pixar' }),
  ];

  it('matches watched movies sharing a director', () => {
    const current = movie({ title: 'WALL-E', imdbId: 'tt-walle', directors: ['Andrew Stanton'], production: 'Pixar' });
    const { directorMatches, studioMatches } = computeCrossovers(current, library);
    expect(directorMatches.map((m) => m.title)).toEqual(['Finding Nemo']);
    // Studio (Pixar) matches both watched Pixar movies.
    expect(studioMatches.map((m) => m.title).sort()).toEqual(['A Bugs Life', 'Finding Nemo']);
  });

  it('excludes the current movie itself from its crossovers', () => {
    const current = movie({ title: 'Finding Nemo', imdbId: 'tt-nemo', directors: ['Andrew Stanton'], production: 'Pixar' });
    const { directorMatches } = computeCrossovers(current, library);
    expect(directorMatches.map((m) => m.title)).not.toContain('Finding Nemo');
  });

  it('ignores unwatched (wishlist) movies', () => {
    const current = movie({ title: 'WALL-E', imdbId: 'tt-walle', directors: ['Andrew Stanton'] });
    const { directorMatches } = computeCrossovers(current, library);
    expect(directorMatches.map((m) => m.title)).not.toContain('Onward');
  });
});

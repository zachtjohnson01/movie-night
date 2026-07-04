import { describe, expect, it } from 'vitest';
import {
  buildNewCandidates,
  findCandidate,
  isOldMovieFormat,
  mergeEntry,
  migrateToEntries,
  toCandidate,
  toEntry,
} from './useMovies';
import { emptyMovie } from './format';
import type { Candidate, LibraryEntry, Movie } from './types';

function movie(over: Partial<Movie> = {}): Movie {
  return { ...emptyMovie(false), ...over };
}
function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    title: 'X',
    year: null,
    imdbId: null,
    imdb: null,
    rottenTomatoes: null,
    commonSenseAge: null,
    studio: null,
    awards: null,
    poster: null,
    addedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}
function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    title: 'X',
    imdbId: null,
    commonSenseAge: null,
    commonSenseScore: null,
    watched: false,
    dateWatched: null,
    notes: null,
    wishlistOrder: null,
    favorite: false,
    ...over,
  };
}

describe('isOldMovieFormat', () => {
  it('detects a flat Movie[] by the presence of `year`', () => {
    expect(isOldMovieFormat([{ year: 2020 }])).toBe(true);
    expect(isOldMovieFormat([{ title: 'x', watched: true }])).toBe(false);
    expect(isOldMovieFormat([])).toBe(false);
  });
});

describe('findCandidate', () => {
  const cands = [
    candidate({ title: 'Bolt', imdbId: 'tt1' }),
    candidate({ title: 'Up', imdbId: 'tt2' }),
  ];
  it('prefers an imdbId match over title', () => {
    expect(findCandidate(cands, { title: 'wrong', imdbId: 'tt2' })?.title).toBe(
      'Up',
    );
  });
  it('falls back to a case-insensitive title match', () => {
    expect(findCandidate(cands, { title: 'bolt', imdbId: null })?.title).toBe(
      'Bolt',
    );
  });
  it('returns undefined when nothing matches', () => {
    expect(findCandidate(cands, { title: 'nope', imdbId: 'ttX' })).toBeUndefined();
  });
});

describe('mergeEntry', () => {
  it('takes user data from the entry and metadata from the candidate', () => {
    const m = mergeEntry(
      entry({
        title: 'Bolt',
        watched: true,
        dateWatched: '2025-01-02',
        notes: 'fun',
        favorite: true,
      }),
      candidate({
        title: 'Bolt',
        imdbId: 'tt1',
        year: 2008,
        poster: 'p.jpg',
        directors: ['Byron Howard'],
        studio: 'Walt Disney',
      }),
    );
    expect(m.watched).toBe(true);
    expect(m.dateWatched).toBe('2025-01-02');
    expect(m.notes).toBe('fun');
    expect(m.favorite).toBe(true);
    expect(m.year).toBe(2008);
    expect(m.poster).toBe('p.jpg');
    expect(m.directors).toEqual(['Byron Howard']);
    expect(m.production).toBe('Walt Disney');
    expect(m.imdbId).toBe('tt1');
  });

  it('surfaces the candidate imdbId when the entry has none', () => {
    const m = mergeEntry(
      entry({ title: 'Bolt', imdbId: null }),
      candidate({ title: 'Bolt', imdbId: 'tt1' }),
    );
    expect(m.imdbId).toBe('tt1');
  });

  it('prefers the per-family commonSenseAge override on the entry', () => {
    const m = mergeEntry(
      entry({ commonSenseAge: '8' }),
      candidate({ commonSenseAge: '6' }),
    );
    expect(m.commonSenseAge).toBe('8');
  });

  it('handles a missing candidate: metadata null, user data kept', () => {
    const m = mergeEntry(entry({ title: 'Manual', watched: true }), undefined);
    expect(m.year).toBeNull();
    expect(m.poster).toBeNull();
    expect(m.directors).toBeNull();
    expect(m.watched).toBe(true);
  });
});

describe('toEntry / toCandidate field routing', () => {
  it('toEntry keeps only the user-overlay fields', () => {
    const e = toEntry(
      movie({ title: 'Bolt', imdbId: 'tt1', watched: true, notes: 'n', year: 2008, poster: 'p' }),
    );
    expect(e).toEqual({
      title: 'Bolt',
      imdbId: 'tt1',
      commonSenseAge: null,
      commonSenseScore: null,
      watched: true,
      dateWatched: null,
      notes: 'n',
      wishlistOrder: null,
      favorite: false,
    });
    expect('year' in e).toBe(false);
    expect('poster' in e).toBe(false);
  });

  it('toCandidate routes metadata onto the existing candidate, preserving addedAt', () => {
    const c = toCandidate(
      movie({ title: 'Bolt', imdbId: 'tt1', year: 2008, production: 'Disney', directors: ['B'] }),
      candidate({ title: 'Bolt', imdbId: 'tt1', addedAt: '2020-01-01T00:00:00Z' }),
    );
    expect(c.year).toBe(2008);
    expect(c.studio).toBe('Disney');
    expect(c.directors).toEqual(['B']);
    expect(c.addedAt).toBe('2020-01-01T00:00:00Z');
  });
});

describe('migrateToEntries / buildNewCandidates', () => {
  it('migrateToEntries strips metadata and keeps the overlay', () => {
    const entries = migrateToEntries([
      movie({ title: 'A', watched: true, year: 2001, poster: 'p' }),
    ]);
    expect(entries[0]).toEqual({
      title: 'A',
      imdbId: null,
      commonSenseAge: null,
      commonSenseScore: null,
      watched: true,
      dateWatched: null,
      notes: null,
      wishlistOrder: null,
      favorite: false,
    });
  });

  it('buildNewCandidates only creates candidates not already in the pool', () => {
    const built = buildNewCandidates(
      [movie({ title: 'A', imdbId: 'ttA' }), movie({ title: 'B', imdbId: 'ttB' })],
      [candidate({ title: 'A', imdbId: 'ttA' })],
    );
    expect(built.map((c) => c.title)).toEqual(['B']);
  });
});

import { describe, expect, it } from 'vitest';
import { affinityScore, buildTasteProfile } from './taste';
import { emptyMovie } from './format';
import type { Movie } from './types';

function mv(over: Partial<Movie> = {}): Movie {
  return { ...emptyMovie(true), title: 'Movie', watched: true, ...over };
}

describe('affinityScore', () => {
  it('averages RT and IMDb when both are present', () => {
    expect(affinityScore(mv({ rottenTomatoes: '90%', imdb: '7.0' }))).toBe(80);
  });

  it('uses whichever rating exists', () => {
    expect(affinityScore(mv({ rottenTomatoes: '90%', imdb: null }))).toBe(90);
    expect(affinityScore(mv({ rottenTomatoes: null, imdb: '6.0' }))).toBe(60);
  });

  it('falls back to a neutral score when unrated', () => {
    expect(affinityScore(mv({ rottenTomatoes: null, imdb: null }))).toBe(60);
  });

  it('ranks a favorite above any unstarred film', () => {
    const star = affinityScore(mv({ rottenTomatoes: '40%', imdb: '4.0', favorite: true }));
    const best = affinityScore(mv({ rottenTomatoes: '100%', imdb: '10.0' }));
    expect(star).toBeGreaterThan(best);
  });
});

describe('buildTasteProfile', () => {
  it('sources only from watched movies, ignoring the wishlist', () => {
    const p = buildTasteProfile([
      mv({ title: 'Seen', watched: true }),
      mv({ title: 'Someday', watched: false, rottenTomatoes: '100%' }),
    ]);
    expect(p.anchors.map((a) => a.title)).toEqual(['Seen']);
    expect(p.watchedCount).toBe(1);
  });

  it('falls back to the whole library when nothing has been watched yet', () => {
    const p = buildTasteProfile([mv({ title: 'Someday', watched: false })]);
    expect(p.anchors.map((a) => a.title)).toEqual(['Someday']);
    // watchedCount stays 0 so the prompt can tell it is working off wishes.
    expect(p.watchedCount).toBe(0);
  });

  it('orders anchors best-loved first, favorites on top', () => {
    const p = buildTasteProfile([
      mv({ title: 'Mediocre', rottenTomatoes: '50%' }),
      mv({ title: 'Great', rottenTomatoes: '95%' }),
      mv({ title: 'Starred', rottenTomatoes: '60%', favorite: true }),
    ]);
    expect(p.anchors.map((a) => a.title)).toEqual(['Starred', 'Great', 'Mediocre']);
  });

  it('breaks affinity ties on the most recent watch date', () => {
    const p = buildTasteProfile([
      mv({ title: 'Older', rottenTomatoes: '80%', dateWatched: '2024-01-01' }),
      mv({ title: 'Newer', rottenTomatoes: '80%', dateWatched: '2026-01-01' }),
    ]);
    expect(p.anchors.map((a) => a.title)).toEqual(['Newer', 'Older']);
  });

  it('ranks creators by summed affinity, not alphabetically', () => {
    const p = buildTasteProfile([
      mv({ title: 'A', rottenTomatoes: '95%', directors: ['Zoe Best'], production: 'Ghibli' }),
      mv({ title: 'B', rottenTomatoes: '95%', directors: ['Zoe Best'], production: 'Ghibli' }),
      mv({ title: 'C', rottenTomatoes: '30%', directors: ['Al Meh'], production: 'Meh Inc' }),
    ]);
    // extractUnique would have sorted these as ['Al Meh', 'Zoe Best'].
    expect(p.directors).toEqual(['Zoe Best', 'Al Meh']);
    expect(p.studios).toEqual(['Ghibli', 'Meh Inc']);
  });

  it('dedupes creators case-insensitively and drops N/A', () => {
    const p = buildTasteProfile([
      mv({ title: 'A', directors: ['Brad Bird', 'N/A', '  '], writers: ['Brad Bird'] }),
      mv({ title: 'B', directors: ['brad bird'] }),
    ]);
    expect(p.directors).toEqual(['Brad Bird']);
    expect(p.writers).toEqual(['Brad Bird']);
    expect(p.studios).toEqual([]);
  });

  it('caps anchors and keeps only the top two directors per anchor', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      mv({ title: `M${i}`, directors: ['One', 'Two', 'Three'] }),
    );
    const p = buildTasteProfile(many);
    expect(p.anchors).toHaveLength(12);
    expect(p.anchors[0].directors).toEqual(['One', 'Two']);
  });

  it('prefers displayTitle for the anchor label', () => {
    const p = buildTasteProfile([
      mv({ title: 'Leiutajatekula Lotte', displayTitle: 'Lotte from Gadgetville' }),
    ]);
    expect(p.anchors[0].title).toBe('Lotte from Gadgetville');
  });

  it('returns empty lists for an empty library', () => {
    const p = buildTasteProfile([]);
    expect(p).toEqual({
      anchors: [],
      directors: [],
      writers: [],
      studios: [],
      watchedCount: 0,
    });
  });
});

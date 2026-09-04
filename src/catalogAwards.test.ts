import { describe, expect, it } from 'vitest';
import { parseAwardTotals, summarizeCatalogAwards } from './catalogAwards';
describe('movie award totals', () => {
  it('does not double-count Oscars already included in explicit totals', () => {
    expect(parseAwardTotals('Won 1 Oscar. 6 wins & 3 nominations total.')).toEqual({ wins: 6, nominations: 3 });
  });
  it('adds an explicitly separate Another count', () => {
    expect(parseAwardTotals('Won 2 Oscars. Another 6 wins & 7 nominations.')).toEqual({ wins: 8, nominations: 7 });
    expect(parseAwardTotals('Nominated for 1 Oscar. Another 3 wins & 7 nominations.')).toEqual({ wins: 3, nominations: 8 });
  });
  it('handles singular, wins-only and nominations-only recorded summaries', () => {
    expect(parseAwardTotals('1 win & 1 nomination')).toEqual({ wins: 1, nominations: 1 });
    expect(parseAwardTotals('3 wins.')).toEqual({ wins: 3, nominations: 0 });
    expect(parseAwardTotals('1 nomination.')).toEqual({ wins: 0, nominations: 1 });
  });
  it('does not invent zero totals for missing, partial or ambiguous strings', () => {
    for (const text of [null, 'N/A', '', 'Won 1 Oscar.', 'Won 1 Oscar. 6 wins & 3 nominations.', 'Award-winning', 'Won 2 Oscars. 1 win total.', 'Another 3 wins.', 'Won 1 Oscar. Another 3 wins total.']) expect(parseAwardTotals(text)).toBeNull();
  });
  it('deduplicates IMDb identity, uses recorded copies, and reports unknown coverage', () => {
    const films = [
      { title: 'A', imdbId: 'tt1', awards: 'Won 1 Oscar. 6 wins & 3 nominations total.' },
      { title: 'Alias', imdbId: 'tt1', awards: null },
      { title: 'B', imdbId: 'tt2', awards: 'Won 2 Oscars. Another 6 wins & 7 nominations.' },
      { title: 'C', imdbId: 'tt3', awards: 'N/A' },
      { title: 'D', imdbId: 'tt4', awards: 'Festival favorite' },
    ];
    expect(summarizeCatalogAwards(films)).toEqual({ wins: 14, nominations: 10, recordedFilms: 2, unknownFilms: 2, totalFilms: 4 });
  });
  it('does not select a favorable total from conflicting duplicate records', () => {
    expect(summarizeCatalogAwards([{ title: 'A', imdbId: 'tt1', awards: '2 wins' }, { title: 'A', imdbId: 'tt1', awards: '3 wins' }])).toMatchObject({ wins: 0, recordedFilms: 0, unknownFilms: 1 });
  });
});

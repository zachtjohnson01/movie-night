import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `OMDB_KEY` is captured at module load, so the key has to be stubbed and the
// module re-imported rather than imported at the top of the file.
type OmdbModule = typeof import('./omdb');
let omdb: OmdbModule;

type SearchHit = { Title: string; Year: string; imdbID: string; Type: string; Poster: string };

function hit(title: string, year: string, id: string): SearchHit {
  return { Title: title, Year: year, imdbID: id, Type: 'movie', Poster: 'N/A' };
}

/**
 * Stub OMDB: `?s=` returns `results`, `?i=` returns a minimal detail record
 * echoing the id it was asked for so the test can assert which one was picked.
 */
function stubOmdb(results: SearchHit[]) {
  const fetchMock = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    if (q.get('i')) {
      return {
        ok: true,
        json: async () => ({
          Response: 'True',
          Title: 'Detail',
          Year: '2000',
          imdbID: q.get('i'),
          Type: 'movie',
          Ratings: [],
        }),
      };
    }
    if (q.get('s')) {
      return results.length
        ? { ok: true, json: async () => ({ Response: 'True', Search: results, totalResults: String(results.length) }) }
        : { ok: true, json: async () => ({ Response: 'False', Error: 'Movie not found!' }) };
    }
    // `?t=` fallback — nothing, so the `?s=` path is what's under test.
    return { ok: true, json: async () => ({ Response: 'False', Error: 'Movie not found!' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.stubEnv('VITE_OMDB_API_KEY', 'test-key');
  vi.resetModules();
  omdb = await import('./omdb');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isCloseMatch', () => {
  it('accepts exact and whole-word-substring matches, rejects reorderings', () => {
    expect(omdb.isCloseMatch("A Bug's Life", 'A Bugs Life')).toBe(true);
    expect(omdb.isCloseMatch('Totoro', 'My Neighbor Totoro')).toBe(true);
    expect(omdb.isCloseMatch('Dog Man', 'Man Bites Dog')).toBe(false);
  });
});

describe('linkByTitle', () => {
  it('picks the result whose year matches the caller-supplied year', async () => {
    stubOmdb([hit('The Lion King', '1994', 'tt0110357'), hit('The Lion King', '2019', 'tt6105098')]);
    const patch = await omdb.linkByTitle('The Lion King', 2019);
    expect(patch?.imdbId).toBe('tt6105098');
  });

  it('tolerates a one-year slop between festival and wide release', async () => {
    stubOmdb([hit('Wolfwalkers', '2020', 'tt5198068'), hit('Wolfwalkers', '2011', 'tt-other')]);
    const patch = await omdb.linkByTitle('Wolfwalkers', 2021);
    expect(patch?.imdbId).toBe('tt5198068');
  });

  it('scans past a non-matching top hit instead of giving up on it', async () => {
    // OMDB's relevance ranking regularly floats an unrelated title to index 0.
    stubOmdb([hit('Man Bites Dog', '1992', 'tt-wrong'), hit('Dog Man', '2025', 'tt-right')]);
    const patch = await omdb.linkByTitle('Dog Man', 2025);
    expect(patch?.imdbId).toBe('tt-right');
  });

  it('falls back to relevance order when no year matches', async () => {
    stubOmdb([hit('Robots', '2005', 'tt-a'), hit('Robots', '1988', 'tt-b')]);
    const patch = await omdb.linkByTitle('Robots', 1975);
    expect(patch?.imdbId).toBe('tt-a');
  });

  it('behaves as before when the caller has no year', async () => {
    stubOmdb([hit('Robots', '2005', 'tt-a'), hit('Robots', '1988', 'tt-b')]);
    expect((await omdb.linkByTitle('Robots'))?.imdbId).toBe('tt-a');
  });

  it('returns null when nothing in the result set is a close match', async () => {
    stubOmdb([hit('Man Bites Dog', '1992', 'tt-wrong')]);
    expect(await omdb.linkByTitle('Dog Man', 2025)).toBeNull();
  });

  it('returns null on no results at all', async () => {
    stubOmdb([]);
    expect(await omdb.linkByTitle('Nonexistent Film', 2025)).toBeNull();
  });
});

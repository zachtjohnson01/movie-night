import { beforeEach, afterEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_OMDB_API_KEY', 'test'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const movie = (Title = 'Belle', Year = '2021', imdbID = 'tt13651628') => ({
  Response: 'True', Title, Year, imdbID, Type: 'movie', Ratings: [],
  imdbRating: 'N/A', Poster: 'N/A', Awards: 'N/A', Production: 'N/A',
});

it('rejects an older namesake rather than trusting a matching title', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(movie('Belle', '1967'))));
  const { enrichCandidateVerified } = await import('./omdb');
  expect(await enrichCandidateVerified('Belle', { year: 2021 })).toBeNull();
});

it('uses the release year and accepts an unrated theatrical film', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(movie()));
  vi.stubGlobal('fetch', fetcher);
  const { enrichCandidateVerified } = await import('./omdb');
  expect(await enrichCandidateVerified('Belle', { year: 2021 })).toMatchObject({ imdb: null, rottenTomatoes: null, year: 2021 });
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('y')).toBe('2021');
});

it('rejects substring matches and television results', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json(movie('Hush Hush Sweet Charlotte', '1964')))
    .mockResolvedValueOnce(Response.json({ ...movie(), Type: 'series' })));
  const { enrichCandidateVerified } = await import('./omdb');
  expect(await enrichCandidateVerified('Charlotte')).toBeNull();
  expect(await enrichCandidateVerified('Belle')).toBeNull();
});

it('recovers from a wrong supplied IMDb ID using title and year', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json(movie('Belle', '1967', 'tt0061395')))
    .mockResolvedValueOnce(Response.json(movie())));
  const { enrichCandidateVerified } = await import('./omdb');
  expect(await enrichCandidateVerified('Belle', { year: 2021, imdbId: 'tt0061395' })).toMatchObject({ imdbId: 'tt13651628' });
});

it('reports quota failures as errors instead of missing films', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ Response: 'False', Error: 'Request limit reached!' })));
  const { enrichCandidateVerified } = await import('./omdb');
  await expect(enrichCandidateVerified('Belle')).rejects.toThrow('Request limit reached');
});

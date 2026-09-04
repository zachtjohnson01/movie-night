import { afterEach, expect, it, vi } from 'vitest';
import { parseReleaseDate, releaseDateLabel } from './releaseDate';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
it('parses exact OMDB and ISO dates without rollover or guesses', () => {
 expect(parseReleaseDate('18 Sep 2026')).toBe('2026-09-18');
 expect(parseReleaseDate('29 Feb 2024')).toBe('2024-02-29');
 for (const value of ['29 Feb 2025', '31 Apr 2026', '2026-13-01', '2026-00-01', '2026-02-30', '2026', 'N/A', 'Sep 2026', '', undefined]) expect(parseReleaseDate(value)).toBeNull();
});
it('uses local calendar today, keeps past and today out of Upcoming', () => {
 const now = new Date(2026, 8, 4, 23, 59);
 expect(releaseDateLabel('2026-09-05', now)).toBe('Upcoming · Sep 5, 2026');
 expect(releaseDateLabel('2026-09-04', now)).toBe('Release date · Sep 4, 2026');
 expect(releaseDateLabel('2026-09-03', now)).toBe('Release date · Sep 3, 2026');
 expect(releaseDateLabel(null, now)).toBeNull();
});
it('propagates OMDB Released through direct and both candidate lookup paths', async () => {
 vi.stubEnv('VITE_OMDB_API_KEY', 'test');
 vi.stubGlobal('fetch', vi.fn(async () => ({ok:true, json:async () => ({Response:'True', Search:[{Title:'Example', Year:'2026', imdbID:'tt123', Type:'movie', Poster:'N/A'}], Title:'Example', Year:'2026', Released:'18 Sep 2026', imdbID:'tt123', imdbRating:'N/A', Ratings:[], Poster:'N/A', Type:'movie'})})));
 const { getMovieById, enrichCandidate, enrichCandidateVerified } = await import('./omdb');
 expect((await getMovieById('tt123')).releaseDate).toBe('2026-09-18');
 expect((await enrichCandidate('Example'))?.releaseDate).toBe('2026-09-18');
 expect((await enrichCandidateVerified('Example', {year:2026}))?.releaseDate).toBe('2026-09-18');
});

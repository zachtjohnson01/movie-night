import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { lookupMovie } from './share-core';

const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';

type MovieRow = {
  family_id: string | null;
  kind: string;
  movies: unknown[];
};

type StubResult = MovieRow[] | { error: { message: string } } | Error;

function stubSupabase(
  movieResult: StubResult,
  familyLookup?: { slug: string; id: string | null },
) {
  const inFn = vi.fn();
  if (movieResult instanceof Error) {
    inFn.mockRejectedValue(movieResult);
  } else if ('error' in movieResult) {
    inFn.mockResolvedValue({ data: null, error: movieResult.error });
  } else {
    inFn.mockResolvedValue({ data: movieResult, error: null });
  }
  // Routes by table name so the families lookup (only used for
  // non-default slugs) doesn't interfere with the movie_night fetch.
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'families') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: familyLookup
                  ? familyLookup.id
                    ? { id: familyLookup.id }
                    : null
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ in: inFn }),
      };
    }),
  } as never);
  return inFn;
}

const BOLT_ENTRY = {
  title: 'Bolt',
  imdbId: 'tt0397892',
  displayTitle: null,
  commonSenseAge: '5+',
};
const BOLT_CANDIDATE = {
  title: 'Bolt',
  imdbId: 'tt0397892',
  year: 2008,
  poster: 'https://m.media-amazon.com/images/M/abc._SX300.jpg',
  rottenTomatoes: '90%',
  imdb: '6.8',
};

const johnsonsLib = (movies: unknown[]): MovieRow => ({
  family_id: JOHNSON_FAMILY_UUID,
  kind: 'library',
  movies,
});

const globalPool = (movies: unknown[]): MovieRow => ({
  family_id: null,
  kind: 'pool',
  movies,
});

describe('lookupMovie', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a joined movie when title matches an entry exactly and imdbId joins to a candidate', async () => {
    stubSupabase([
      johnsonsLib([BOLT_ENTRY]),
      globalPool([BOLT_CANDIDATE]),
    ]);
    const r = await lookupMovie(null, 'Bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.movie?.poster).toBe(BOLT_CANDIDATE.poster);
    expect(r.movie?.year).toBe(2008);
    expect(r.debug.entryMatch).toBe('exact');
    expect(r.debug.candidateMatch).toBe('imdbId');
    expect(r.debug.familyId).toBe(JOHNSON_FAMILY_UUID);
  });

  it('matches case-insensitively when the title casing differs', async () => {
    stubSupabase([johnsonsLib([BOLT_ENTRY]), globalPool([BOLT_CANDIDATE])]);
    const r = await lookupMovie(null, 'BOLT');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.debug.entryMatch).toBe('ci');
  });

  it('falls back to title-based candidate match when imdbId join fails', async () => {
    stubSupabase([
      johnsonsLib([{ ...BOLT_ENTRY, imdbId: 'tt9999999' }]),
      globalPool([BOLT_CANDIDATE]),
    ]);
    const r = await lookupMovie(null, 'Bolt');
    expect(r.movie?.poster).toBe(BOLT_CANDIDATE.poster);
    expect(r.debug.candidateMatch).toBe('ci');
  });

  it('returns a candidate-only movie when no library entry exists', async () => {
    stubSupabase([johnsonsLib([]), globalPool([BOLT_CANDIDATE])]);
    const r = await lookupMovie(null, 'Bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.movie?.poster).toBe(BOLT_CANDIDATE.poster);
    expect(r.debug.entryMatch).toBe('none');
    expect(r.debug.candidateMatch).toBe('exact');
  });

  it('matches candidate-only with case drift', async () => {
    stubSupabase([johnsonsLib([]), globalPool([BOLT_CANDIDATE])]);
    const r = await lookupMovie(null, 'bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.debug.candidateMatch).toBe('ci');
  });

  it('returns {movie: null} when title is not found anywhere', async () => {
    stubSupabase([johnsonsLib([BOLT_ENTRY]), globalPool([BOLT_CANDIDATE])]);
    const r = await lookupMovie(null, 'Missing');
    expect(r.movie).toBeNull();
    expect(r.debug.entryMatch).toBe('none');
    expect(r.debug.candidateMatch).toBe('none');
  });

  it('returns {movie: null} for empty title without calling Supabase', async () => {
    const inFn = stubSupabase([]);
    const r = await lookupMovie(null, '');
    expect(r.movie).toBeNull();
    expect(inFn).not.toHaveBeenCalled();
  });

  it('captures Supabase error messages in debug.supabaseError instead of throwing', async () => {
    stubSupabase({ error: { message: 'connection refused' } });
    const r = await lookupMovie(null, 'Bolt');
    expect(r.movie).toBeNull();
    expect(r.debug.supabaseError).toBe('connection refused');
  });

  it('catches thrown errors from Supabase and reports them in debug.supabaseError', async () => {
    stubSupabase(new Error('network down'));
    const r = await lookupMovie(null, 'Bolt');
    expect(r.movie).toBeNull();
    expect(r.debug.supabaseError).toBe('network down');
  });

  it('returns counts of entries and candidates in debug', async () => {
    stubSupabase([
      johnsonsLib([BOLT_ENTRY, { title: 'Up' }, { title: 'Cars' }]),
      globalPool([BOLT_CANDIDATE, { title: 'Up' }]),
    ]);
    const r = await lookupMovie(null, 'Bolt');
    expect(r.debug.entryCount).toBe(3);
    expect(r.debug.candidateCount).toBe(2);
  });

  it('scopes the library lookup to the resolved family_id', async () => {
    const otherFamilyId = '00000002-0000-0000-0000-000000000002';
    stubSupabase(
      [
        johnsonsLib([BOLT_ENTRY]),
        { family_id: otherFamilyId, kind: 'library', movies: [] },
        globalPool([BOLT_CANDIDATE]),
      ],
      { slug: 'smith', id: otherFamilyId },
    );
    const r = await lookupMovie('smith', 'Bolt');
    expect(r.debug.familyId).toBe(otherFamilyId);
    expect(r.debug.entryMatch).toBe('none');
    // Pool is global, so the candidate-only fallback still resolves.
    expect(r.movie?.title).toBe('Bolt');
    expect(r.debug.candidateMatch).toBe('exact');
  });

  it('returns {movie: null} for an unknown slug', async () => {
    stubSupabase(
      [johnsonsLib([BOLT_ENTRY]), globalPool([BOLT_CANDIDATE])],
      { slug: 'ghost', id: null },
    );
    const r = await lookupMovie('ghost', 'Bolt');
    expect(r.movie).toBeNull();
    expect(r.debug.supabaseError).toContain('ghost');
  });

  it('treats slug "johnson" as the bootstrap family without an extra lookup', async () => {
    const inFn = stubSupabase([
      johnsonsLib([BOLT_ENTRY]),
      globalPool([BOLT_CANDIDATE]),
    ]);
    const r = await lookupMovie('johnson', 'Bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.debug.familyId).toBe(JOHNSON_FAMILY_UUID);
    expect(inFn).toHaveBeenCalledOnce();
  });

  it('returns {movie: null} when env is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.resetModules();
    const { lookupMovie: freshLookup } = await import('./share-core');
    const r = await freshLookup(null, 'Bolt');
    expect(r.movie).toBeNull();
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });
});

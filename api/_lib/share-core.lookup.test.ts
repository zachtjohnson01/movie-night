import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { lookupMovie } from './share-core';

type Row = { id: number; movies: unknown[] };

function stubSupabase(rows: Row[] | { error: { message: string } } | Error) {
  const inFn = vi.fn();
  if (rows instanceof Error) {
    inFn.mockRejectedValue(rows);
  } else if ('error' in rows) {
    inFn.mockResolvedValue({ data: null, error: rows.error });
  } else {
    inFn.mockResolvedValue({ data: rows, error: null });
  }
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ in: inFn }),
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

describe('lookupMovie', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a joined movie when title matches an entry exactly and imdbId joins to a candidate', async () => {
    stubSupabase([
      { id: 1, movies: [BOLT_ENTRY] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    const r = await lookupMovie('Bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.movie?.poster).toBe(BOLT_CANDIDATE.poster);
    expect(r.movie?.year).toBe(2008);
    expect(r.debug.entryMatch).toBe('exact');
    expect(r.debug.candidateMatch).toBe('imdbId');
  });

  it('matches case-insensitively when the title casing differs', async () => {
    stubSupabase([
      { id: 1, movies: [BOLT_ENTRY] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    const r = await lookupMovie('BOLT');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.debug.entryMatch).toBe('ci');
  });

  it('falls back to title-based candidate match when imdbId join fails', async () => {
    stubSupabase([
      { id: 1, movies: [{ ...BOLT_ENTRY, imdbId: 'tt9999999' }] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    const r = await lookupMovie('Bolt');
    expect(r.movie?.poster).toBe(BOLT_CANDIDATE.poster);
    expect(r.debug.candidateMatch).toBe('ci');
  });

  it('returns a candidate-only movie when no library entry exists', async () => {
    stubSupabase([
      { id: 1, movies: [] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    const r = await lookupMovie('Bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.movie?.poster).toBe(BOLT_CANDIDATE.poster);
    expect(r.debug.entryMatch).toBe('none');
    expect(r.debug.candidateMatch).toBe('exact');
  });

  it('matches candidate-only with case drift', async () => {
    stubSupabase([
      { id: 1, movies: [] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    const r = await lookupMovie('bolt');
    expect(r.movie?.title).toBe('Bolt');
    expect(r.debug.candidateMatch).toBe('ci');
  });

  it('returns {movie: null} when title is not found anywhere', async () => {
    stubSupabase([
      { id: 1, movies: [BOLT_ENTRY] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    const r = await lookupMovie('Missing');
    expect(r.movie).toBeNull();
    expect(r.debug.entryMatch).toBe('none');
    expect(r.debug.candidateMatch).toBe('none');
  });

  it('returns {movie: null} for empty title without calling Supabase', async () => {
    const inFn = stubSupabase([]);
    const r = await lookupMovie('');
    expect(r.movie).toBeNull();
    expect(inFn).not.toHaveBeenCalled();
  });

  it('captures Supabase error messages in debug.supabaseError instead of throwing', async () => {
    stubSupabase({ error: { message: 'connection refused' } });
    const r = await lookupMovie('Bolt');
    expect(r.movie).toBeNull();
    expect(r.debug.supabaseError).toBe('connection refused');
  });

  it('catches thrown errors from Supabase and reports them in debug.supabaseError', async () => {
    stubSupabase(new Error('network down'));
    const r = await lookupMovie('Bolt');
    expect(r.movie).toBeNull();
    expect(r.debug.supabaseError).toBe('network down');
  });

  it('returns counts of entries and candidates in debug', async () => {
    stubSupabase([
      { id: 1, movies: [BOLT_ENTRY, { title: 'Up' }, { title: 'Cars' }] },
      { id: 2, movies: [BOLT_CANDIDATE, { title: 'Up' }] },
    ]);
    const r = await lookupMovie('Bolt');
    expect(r.debug.entryCount).toBe(3);
    expect(r.debug.candidateCount).toBe(2);
  });

  it('returns {movie: null} when env is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.resetModules();
    const { lookupMovie: freshLookup } = await import('./share-core');
    const r = await freshLookup('Bolt');
    expect(r.movie).toBeNull();
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });
});

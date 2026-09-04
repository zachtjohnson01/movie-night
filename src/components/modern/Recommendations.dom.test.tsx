// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('../../supabase', () => ({ supabase: {} }));
import ModernRecommendations from './Recommendations';
import Recommendations from '../Recommendations';
import type { Candidate } from '../../types';
import type { CandidatePoolApi } from '../../useCandidatePool';
import { DEFAULT_WEIGHTS } from '../../scoring';
afterEach(cleanup);
const candidate: Candidate = { title: 'New family film', year: 2026, imdbId: 'tt36841161', imdb: null, rottenTomatoes: null, commonSenseAge: null, studio: null, awards: null, poster: null, addedAt: '2026-09-04', type: 'movie' };
const pool = { candidates: [candidate], weights: DEFAULT_WEIGHTS, loading: false } as unknown as CandidatePoolApi;
describe.each([['modern', ModernRecommendations], ['classic', Recommendations]] as const)('%s unrated recommendation', (_name, Component) => {
  it('shows missing review and suitability information without claiming availability', () => {
    render(<Component movies={[]} pool={pool} isOwner={false} reloadMovies={() => {}} onSelectPick={() => {}} />);
    expect(screen.getByText('New family film')).toBeInTheDocument();
    expect(screen.getByText('Ratings pending')).toBeInTheDocument();
    expect(screen.getByText('Age guidance unknown')).toBeInTheDocument();
    expect(screen.getByText('Availability not checked')).toBeInTheDocument();
    expect(screen.queryByText(/watch now/i)).toBeNull();
  });
  it('shows an upcoming label only when a full future release date is present', () => {
    const futurePool = { ...pool, candidates: [{ ...candidate, releaseDate: '2099-09-18' }] } as CandidatePoolApi;
    render(<Component movies={[]} pool={futurePool} isOwner={false} reloadMovies={() => {}} onSelectPick={() => {}} />);
    expect(screen.getByText(/Upcoming/)).toBeInTheDocument();
    expect(screen.queryByText(/watch now/i)).toBeNull();
  });

});

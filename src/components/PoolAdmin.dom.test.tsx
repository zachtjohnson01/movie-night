// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PoolAdmin from './PoolAdmin';
import type { Candidate } from '../types';
import type { CandidatePoolApi } from '../useCandidatePool';
import { DEFAULT_WEIGHTS } from '../scoring';
import { expandPool } from '../recommendations';
vi.mock('../recommendations', async (original) => ({ ...await original<typeof import('../recommendations')>(), expandPool: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const movie = (title: string, extra: Partial<Candidate> = {}): Candidate => ({title, year: 2024, imdbId: title, imdb: '8', rottenTomatoes: null, commonSenseAge: '6+', studio: null, awards: null, poster: null, addedAt: '2026-01-01', ...extra});
function pool(candidates = [movie('Coco'), movie('Paddington', {studio:'StudioCanal'})]): CandidatePoolApi {
  return { candidates, status:'synced', weights:DEFAULT_WEIGHTS, reasons:[], appendCandidates:vi.fn(async next => next), updateCandidate:vi.fn(), replaceCandidates:vi.fn(), toggleDownvote:vi.fn(), removeCandidate:vi.fn(), restoreCandidate:vi.fn(), updateWeights:vi.fn(), reload:vi.fn(), bulkRefreshOmdb:vi.fn(), bulkRefreshStreaming:vi.fn() };
}
describe('Manage pool', () => {
  it('searches studio and clears an empty search', () => {
    render(<PoolAdmin pool={pool()} movies={[]} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox'), {target:{value:'StudioCanal'}});
    expect(screen.getByRole('button', {name:'Edit Paddington'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Edit Coco'})).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), {target:{value:'no match'}});
    fireEvent.click(screen.getByRole('button', {name:'Clear search and filters'}));
    expect(screen.getByRole('button', {name:'Edit Coco'})).toBeInTheDocument();
  });
  it('reports only persisted additions and skipped duplicates', async () => {
    const p=pool();
    vi.mocked(expandPool).mockResolvedValue([movie('New'), movie('Coco')]);
    vi.mocked(p.appendCandidates).mockResolvedValue([movie('New')]);
    render(<PoolAdmin pool={p} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'Expand pool'}));
    await screen.findByText('Added 1 movie to the pool');
    expect(screen.getByText('1 existing or duplicate matches skipped at save.')).toBeInTheDocument();
  });
  it('never shows success when persistence fails', async () => {
    const p=pool();
    vi.mocked(expandPool).mockResolvedValue([movie('New')]);
    vi.mocked(p.appendCandidates).mockRejectedValue(new Error('Save failed'));
    render(<PoolAdmin pool={p} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'Expand pool'}));
    await screen.findByRole('alert');
    expect(screen.queryByText(/Added .* to the pool/)).toBeNull();
  });
  it('keeps new titles with pending ratings visible in All and sorts by date', () => {
    render(<PoolAdmin pool={pool([movie('Old'), movie('Newest',{imdb:null, addedAt:'2026-09-04'})])} movies={[]} onBack={() => {}} />);
    expect(screen.getByText('Ratings pending')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox',{name:'Sort movies'}), {target:{value:'newest'}});
    expect(screen.getAllByRole('button',{name:/^Edit /})[0]).toHaveAccessibleName('Edit Newest');
  });
  it('disables repeat expansion until the first save completes', async () => {
    let finish!: (c: Candidate[]) => void;
    vi.mocked(expandPool).mockImplementation(() => new Promise(resolve => { finish=resolve; }));
    render(<PoolAdmin pool={pool()} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'Expand pool'}));
    expect(screen.getByRole('button',{name:'Expanding pool…'})).toBeDisabled();
    finish([]);
    await waitFor(() => expect(screen.getByRole('button',{name:'Expand pool'})).toBeEnabled());
  });
});

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PoolAdmin from './PoolAdmin';
import type { Candidate } from '../types';
import type { CandidatePoolApi } from '../useCandidatePool';
import { DEFAULT_WEIGHTS } from '../scoring';
import { expandPoolDetailed, type ExpansionReport } from '../recommendations';
vi.mock('../recommendations', async (original) => ({ ...await original<typeof import('../recommendations')>(), expandPoolDetailed: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const movie = (title: string, extra: Partial<Candidate> = {}): Candidate => ({title, year: 2024, imdbId: title, imdb: '8', rottenTomatoes: null, commonSenseAge: '6+', studio: null, awards: null, poster: null, addedAt: '2026-01-01', ...extra});
const report = (candidates: Candidate[]): ExpansionReport => ({mode:'enhanced',candidates,raw:candidates.length,checked:candidates.length,unmatched:0,errors:0,duplicates:0,verified:candidates.length,status:'complete',api:{}});
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
    vi.mocked(expandPoolDetailed).mockResolvedValue(report([movie('New'), movie('Coco')]));
    vi.mocked(p.appendCandidates).mockResolvedValue([movie('New')]);
    render(<PoolAdmin pool={p} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'Expand pool'}));
    await screen.findByText('Added 1 movie to the pool');
    expect(screen.getByText('1 existing or duplicate matches skipped at save.')).toBeInTheDocument();
  });
  it('never shows success when persistence fails', async () => {
    const p=pool();
    vi.mocked(expandPoolDetailed).mockResolvedValue(report([movie('New')]));
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
    let finish!: (c: ExpansionReport) => void;
    vi.mocked(expandPoolDetailed).mockImplementation(() => new Promise(resolve => { finish=resolve; }));
    render(<PoolAdmin pool={pool()} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'Expand pool'}));
    expect(screen.getByRole('button',{name:'Expanding pool…'})).toBeDisabled();
    finish(report([]));
    await waitFor(() => expect(screen.getByRole('button',{name:'Expand pool'})).toBeEnabled());
  });
  it('compares from identical inputs without saving either result', async () => {
    const p = pool();
    vi.mocked(expandPoolDetailed).mockResolvedValueOnce({...report([movie('Original')]),mode:'baseline'}).mockResolvedValueOnce(report([movie('Enhanced'),movie('Another')]));
    render(<PoolAdmin pool={p} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', {name:'Compare old vs new'}));
    await screen.findByText(/Difference: 1 verified candidates/);
    expect(p.appendCandidates).not.toHaveBeenCalled();
    const calls = vi.mocked(expandPoolDetailed).mock.calls;
    expect(calls[0].slice(0,4)).toEqual(calls[1].slice(0,4));
    expect(calls[0][5]?.mode).toBe('baseline');
    expect(calls[1][5]?.mode).toBe('enhanced');
  });

  it('still runs enhanced comparison after the baseline service fails', async () => {
    const p = pool();
    vi.mocked(expandPoolDetailed).mockRejectedValueOnce(new Error('Baseline unavailable')).mockResolvedValueOnce(report([movie('Enhanced')]));
    render(<PoolAdmin pool={p} movies={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', {name:'Compare old vs new'}));
    await screen.findByText('Baseline unavailable');
    await screen.findByText('Enhanced (2024)');
    expect(p.appendCandidates).not.toHaveBeenCalled();
    expect(screen.queryByText(/Difference:/)).toBeNull();
  });

  it('reuses catalog details and keeps downvote separate from opening the editor', () => {
    const p = pool([movie('Family movie', { poster: 'https://example.com/poster.jpg', studio: 'Film Studio', awards: '2 wins', releaseDate: '2099-09-18', rottenTomatoes: '95%' })]);
    const { container } = render(<PoolAdmin pool={p} movies={[]} onBack={() => {}} />);
    const edit = screen.getByRole('button', {name: 'Edit Family movie'});
    expect(edit).toHaveTextContent('Film Studio');
    expect(edit).toHaveTextContent('2 wins');
    expect(edit).toHaveTextContent('Upcoming');
    expect(edit).toHaveTextContent('95%');
    expect(edit.querySelector('img')).not.toBeNull();
    const downvote = screen.getByRole('button', {name: 'Downvote Family movie'});
    expect(downvote).toHaveClass('w-11', 'h-11');
    expect(container.querySelector('button button')).toBeNull();
    fireEvent.click(downvote);
    expect(p.toggleDownvote).toHaveBeenCalledWith('Family movie');
    expect(p.removeCandidate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name:'Save'})).toBeNull();
    fireEvent.click(edit);
    expect(screen.getByRole('button', {name:'Save'})).toBeInTheDocument();
  });

});

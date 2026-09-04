// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from './types';
const db = vi.hoisted(() => ({ stored: [] as unknown[], error: false, zeroRows: false, writes: 0 }));
vi.mock('./supabase', () => ({
  MOVIE_NIGHT_TABLE:'movie_night', isSupabaseConfigured:true,
  supabase: {
    from: () => {
      let payload: {movies: unknown[]} | undefined;
      let kind='';
      const query = {
        select: () => query, is: () => query,
        eq: (_key: string, value: string) => {kind=value; return query;},
        update: (value: {movies: unknown[]}) => {payload=value; return query;},
        maybeSingle: async () => ({data:{movies:kind==='pool' ? db.stored : null}, error:null}),
        single: async () => {
          db.writes++;
          if(db.error) return {data:null,error:{message:'denied'}};
          if(db.zeroRows) return {data:null,error:null};
          db.stored=payload!.movies;
          return {data:{movies:db.stored}, error:null};
        },
      };
      return query;
    },
    channel: () => { const channel={on:()=>channel,subscribe:()=>channel}; return channel; },
    removeChannel: vi.fn(),
  },
}));
import { useCandidatePool } from './useCandidatePool';
const movie = (title: string): Candidate => ({title, year:null, imdbId:title, imdb:null, rottenTomatoes:null, commonSenseAge:null, studio:null, awards:null, poster:null, addedAt:'2026-09-04'});
beforeEach(() => {db.stored=[movie('Existing')]; db.error=false; db.zeroRows=false; db.writes=0;});
afterEach(cleanup);
describe('confirmed pool additions', () => {
  it('returns only new saved movies and retains them after remount', async () => {
    const first=renderHook(useCandidatePool);
    await waitFor(()=>expect(first.result.current.status).toBe('synced'));
    await act(async()=>expect(await first.result.current.appendCandidates([movie('Existing'),movie('New')])).toEqual([movie('New')]));
    first.unmount();
    const second=renderHook(useCandidatePool);
    await waitFor(()=>expect(second.result.current.candidates).toHaveLength(2));
    await act(async()=>expect(await second.result.current.appendCandidates([movie('New')])).toEqual([]));
    expect(db.writes).toBe(1);
  });
  it.each(['error','zeroRows'] as const)('rejects %s without displaying unsaved additions', async mode => {
    const {result}=renderHook(useCandidatePool);
    await waitFor(()=>expect(result.current.status).toBe('synced'));
    db[mode]=true;
    await act(async()=>{await expect(result.current.appendCandidates([movie('New')])).rejects.toThrow('could not be saved');});
    expect(result.current.candidates.map(c=>c.title)).toEqual(['Existing']);
  });
});

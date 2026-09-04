import { describe, expect, it, vi } from 'vitest';
import type { Candidate } from './types';
import type { OmdbMoviePatch } from './omdb';
import { allowedRepairPoster, applyPosterRepairs, scanPosterRepairs } from './posterRepair';
const film = (over:Partial<Candidate> = {}):Candidate => ({title:'A film',year:2020,imdbId:'tt1',poster:null,imdb:null,rottenTomatoes:null,commonSenseAge:null,studio:null,awards:null,addedAt:'2026-01-01',...over});
const patch = (over:Partial<OmdbMoviePatch> = {}):OmdbMoviePatch => ({title:'A film',year:2020,imdbId:'tt1',poster:'https://m.media-amazon.com/new.jpg',imdb:null,rottenTomatoes:null,awards:null,production:null,directors:null,writers:null,type:'movie',...over});
const dependencies = (record=patch()) => ({byId:vi.fn().mockResolvedValue(record),byTitle:vi.fn().mockResolvedValue(record),probe:vi.fn().mockResolvedValue(true)});
describe('poster and link repairs',()=>{
  it('repairs verified missing posters and missing IDs only',async()=>{
    const deps=dependencies();
    const report=await scanPosterRepairs([film(),film({title:'A film',imdbId:null,addedAt:'2026-02-01'})],()=>{}, {cancelled:false},deps);
    expect(report.patches).toHaveLength(2);
    expect(report.review).toHaveLength(0);
    const applied=applyPosterRepairs([film()],report.patches.slice(0,1));
    expect(applied.repaired).toBe(1);expect(applied.candidates[0].poster).toContain('new.jpg');
  });
  it('routes wrong sequel records and mini-movie collections for review without replacing them',async()=>{
    const candidate=film({title:'Minions 3',year:2016,imdbId:'tt6173116'});
    const deps=dependencies(patch({title:'Illumination Mini-Movie Collection',year:2016,imdbId:'tt6173116'}));
    const report=await scanPosterRepairs([candidate],()=>{}, {cancelled:false},deps);
    expect(report.review).toHaveLength(1);expect(report.patches).toHaveLength(0);
    expect(deps.byTitle).not.toHaveBeenCalled();expect(deps.probe).not.toHaveBeenCalled();
  });
  it('will not infer an identity from a one-year offset or missing year',async()=>{
    for(const year of [2021,null]){
      const report=await scanPosterRepairs([film({year})],()=>{}, {cancelled:false},dependencies());
      expect(report.patches).toHaveLength(0);expect(report.review).toHaveLength(1);
    }
  });
  it('repairs a failing old image only when the replacement loads',async()=>{
    const deps=dependencies();deps.probe.mockImplementation(async url=>url.endsWith('new.jpg'));
    const original=film({poster:'https://m.media-amazon.com/broken.jpg'});
    const report=await scanPosterRepairs([original],()=>{}, {cancelled:false},deps);
    expect(report.patches[0].poster).toContain('new.jpg');
    deps.probe.mockResolvedValue(false);
    const unresolved=await scanPosterRepairs([original],()=>{}, {cancelled:false},deps);
    expect(unresolved.unresolved).toBe(1);expect(unresolved.patches).toHaveLength(0);
  });
  it('does not overwrite concurrent identity or poster edits, family metadata or removed records',()=>{
    const original=film({downvoted:true,commonSenseAge:'7+'});
    const proposed={original,imdbId:'tt1',poster:'https://m.media-amazon.com/new.jpg'};
    for(const current of [film({imdbId:'tt2'}),film({poster:'manual.jpg'}),film({removedAt:'2026-09-04'})]) expect(applyPosterRepairs([current],[proposed]).repaired).toBe(0);
    expect(applyPosterRepairs([original],[proposed]).candidates[0]).toMatchObject({title:'A film',downvoted:true,commonSenseAge:'7+'});
  });
  it('stops without work when cancelled and reports lookup failures',async()=>{
    const deps=dependencies();deps.byId.mockRejectedValue(new Error('network'));
    expect((await scanPosterRepairs([film()],()=>{}, {cancelled:true},deps)).cancelled).toBe(true);
    expect(deps.byId).not.toHaveBeenCalled();
    expect((await scanPosterRepairs([film()],()=>{}, {cancelled:false},deps)).failed).toBe(1);
  });
  it('allows only the known HTTPS poster host without credentials or custom ports',()=>{
    expect(allowedRepairPoster('https://m.media-amazon.com/image.jpg')).toBe(true);
    for(const url of ['http://m.media-amazon.com/image.jpg','https://localhost/image','https://m.media-amazon.com.evil.test/a','https://user:secret@m.media-amazon.com/a','https://m.media-amazon.com:444/a']) expect(allowedRepairPoster(url)).toBe(false);
  });
});

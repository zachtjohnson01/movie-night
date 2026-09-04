import { describe, expect, it } from 'vitest';
import { creatorCatalogMatches } from './creatorCatalog';
import { candidateToTemplate } from './format';
import type { Candidate } from './types';
const film = (title:string, extra:Partial<Candidate>={}):Candidate => ({title,year:2025,imdbId:title,imdb:null,rottenTomatoes:null,poster:null,commonSenseAge:null,studio:'Pixar',awards:null,addedAt:'2026-01-01',directors:[' Jane Doe '],writers:['Other Writer'],...extra});
describe('creator catalog', () => {
  it('uses full catalog, exact normalized role names, includes unrated and excludes source and removed', () => {
    const origin=film('Origin');
    const result=creatorCatalogMatches([origin,film('Other'),film('Wrong',{directors:['Jane Doe Jr']}),film('Removed',{removedAt:'2026-02-01'}),film('Flagged',{removedReason:'Not a movie'}),film('Writer only',{directors:[],writers:['Jane Doe']})],[],{role:'director',name:'jane   doe',origin:candidateToTemplate(origin)});
    expect(result.map(m=>m.title)).toEqual(['Other']);
  });
  it('dedupes IMDb identities but preserves distinct remakes and matches studio field', () => {
    const first=film('First',{imdbId:'same'});
    const result=creatorCatalogMatches([first,film('Alias',{imdbId:'same'}),film('First',{imdbId:'remake',year:2026})],[candidateToTemplate(first)],{role:'studio',name:'pixar',origin:candidateToTemplate(film('Origin'))});
    expect(result).toHaveLength(2);
    expect(result.map(m=>m.year)).toEqual([2026,2025]);
  });
  it('does not hide an active survivor because its removed duplicate has the same ID', () => {
    const result=creatorCatalogMatches([film('Active'),film('Old alias',{imdbId:'Active',removedAt:'2026-01-01'})],[],{role:'director',name:'Jane Doe',origin:candidateToTemplate(film('Origin'))});
    expect(result.map(m=>m.title)).toEqual(['Active']);
  });
});

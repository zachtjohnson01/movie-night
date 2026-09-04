import { describe, expect, it } from 'vitest';
import { buildHistoryProfile, historyScore, rankHistoryPicks, approximateHistoryWeights, personalBlendWeight, normalizeHistorySettings, DEFAULT_HISTORY_SETTINGS, historySettingsError } from './historyRecommendations';
import { rankTopPicks } from './recommendations';
import { emptyMovie } from './format';
import { DEFAULT_WEIGHTS } from './scoring';
import type { Candidate, Movie } from './types';
const watched=(i:number,extra:Partial<Movie>={}):Movie=>({...emptyMovie(true),title:`Watched ${i}`,imdbId:`watched-${i}`,watched:true,directors:['Director A'],writers:['Writer A'],production:'Studio A',commonSenseAge:'7+',...extra});
const film=(title:string,extra:Partial<Candidate>={}):Candidate=>({title,imdbId:title,year:2027,imdb:null,rottenTomatoes:null,commonSenseAge:'7+',studio:'Studio A',directors:['Director A'],writers:['Writer A'],awards:null,poster:null,addedAt:'2026-01-01',...extra});
const history=Array.from({length:10},(_,i)=>watched(i));
describe('watch history recommendations',()=>{
 it('requires ten distinct watched films with metadata and does not count queued favorites toward activation',()=>{
  const nine=history.slice(0,9);
  expect(buildHistoryProfile([...nine,nine[0],watched(99,{watched:false,favorite:true})]).ready).toBe(false);
  expect(buildHistoryProfile([...nine,watched(99,{directors:null,writers:null,production:null,commonSenseAge:null})]).count).toBe(9);
  expect(buildHistoryProfile(history).ready).toBe(true);
 });
 it('preserves exact preset output below threshold',()=>{
  const pool=[film('A'),film('B',{imdb:'9'})];
  expect(rankHistoryPicks(pool,history.slice(0,9))).toEqual(rankTopPicks(pool,history.slice(0,9)));
 });
 it('learns different film affinities per family without mutating shared weights',()=>{
  const pool=[film('A'),film('B',{directors:['Director B'],writers:['Writer B'],studio:'Studio B',commonSenseAge:'11+'})];
  const familyB=history.map(m=>({...m,directors:['Director B'],writers:['Writer B'],production:'Studio B',commonSenseAge:'11+'}));
  const weights={...DEFAULT_WEIGHTS};
  expect(rankHistoryPicks(pool,history,20,weights)[0].title).toBe('A');
  expect(rankHistoryPicks(pool,familyB,20,weights)[0].title).toBe('B');
  expect(weights).toEqual(DEFAULT_WEIGHTS);
  expect(rankHistoryPicks(pool,history)).toEqual(rankHistoryPicks(pool,history));
 });
 it('gives favorites exactly 1.25 weight without advancing watched count for queued favorites',()=>{
  const diverse=history.map((m,i)=>i<5 ? m : {...m,directors:['B'],writers:['B'],production:'B',commonSenseAge:'12+'});
  const normal=buildHistoryProfile(diverse);const favorite=buildHistoryProfile(diverse.map((m,i)=>({...m,favorite:i===0})));
  expect(favorite.films[0].weight).toBe(1.25);
  expect(historyScore(film('A'),favorite)).toBeGreaterThan(historyScore(film('A'),normal));
  expect(buildHistoryProfile([...diverse,watched(50,{watched:false,favorite:true})]).count).toBe(normal.count);
  expect(buildHistoryProfile([...diverse,watched(50,{watched:false,favorite:true})]).films.slice(-1)[0]?.weight).toBe(1.25);
 });
 it('retains unrated future films and shared eligibility exclusions',()=>{
  const pool=[film('Future'),film('Removed',{removedAt:'date'}),film('Invalid',{type:'series'}),film('Unlinked',{imdbId:null}),film('In wishlist'),film('Watched 0',{imdbId:'watched-0'})];
  const movies=[...history,{...emptyMovie(false),title:'In wishlist'}];
  expect(rankHistoryPicks(pool,movies).map(c=>c.title)).toEqual(['Future']);
 });
 it('returns deterministic bounded percentage approximation totaling 100',()=>{
  const pool=[film('A'),film('B',{imdb:'9.8',studio:'B',directors:['B']})];
  const fit=approximateHistoryWeights(pool,history)!;
  expect(Object.values(fit.weights).reduce((a,b)=>a+b,0)).toBe(100);
  expect(fit).toEqual(approximateHistoryWeights(pool,history));
 });
});

it('queue adds a weaker taste signal while its movie stays excluded from picks',()=>{
 const queued=watched(50,{watched:false,directors:['Director B'],writers:['Writer B'],production:'Studio B',commonSenseAge:'12+'});
 const candidate=film('B',{directors:['Director B'],writers:['Writer B'],studio:'Studio B',commonSenseAge:'12+'});
 const profile=buildHistoryProfile([...history,queued]);
 expect(profile.count).toBe(10);expect(profile.queueCount).toBe(1);expect(profile.films.slice(-1)[0]?.weight).toBe(0.5);
 expect(historyScore(candidate,profile)).toBeGreaterThan(historyScore(candidate,buildHistoryProfile(history)));
 expect(rankHistoryPicks([candidate,film(queued.title,{imdbId:queued.imdbId})],[...history,queued]).map(m=>m.title)).toEqual(['B']);
});
it('deduplicates favorites, watched and queued copies into strongest single signal',()=>{
 const copies=[watched(1),watched(1,{watched:false,favorite:true}),watched(1,{watched:false})];
 const profile=buildHistoryProfile(copies);
 expect(profile.films).toHaveLength(1);expect(profile.films[0].weight).toBe(1.25);expect(profile.count).toBe(1);
});
it('ramps personal contribution conservatively and retains preset contribution',()=>{
 expect(personalBlendWeight(9)).toBe(0);expect(personalBlendWeight(10)).toBe(0.5);expect(personalBlendWeight(20)).toBe(0.625);expect(personalBlendWeight(30)).toBe(0.75);expect(personalBlendWeight(100)).toBe(0.75);
 const candidate=film('Only',{imdb:'8.1',rottenTomatoes:'85%'});
 const preset=rankTopPicks([candidate],history)[0].fitScore;
 expect(rankHistoryPicks([candidate],history)[0].fitScore).toBe(Math.round(0.5*historyScore(candidate,buildHistoryProfile(history))+0.5*preset));
});

it('uses highest applicable configured signal once and retains watched threshold with zero influence',()=>{
 const settings={favorite:0.25,watched:2,queue:0,presetPercent:0};
 const profile=buildHistoryProfile([...history.map(m=>({...m,favorite:true})),watched(50,{watched:false})],settings);
 expect(profile.count).toBe(10);expect(profile.ready).toBe(true);expect(profile.favoriteCount).toBe(10);
 expect(profile.films[0].weight).toBe(2);expect(profile.films[10].weight).toBe(0);
 const zeroWatched=buildHistoryProfile(history,{favorite:1,watched:0,queue:0,presetPercent:25});
 expect(zeroWatched.count).toBe(10);expect(zeroWatched.films.every(m=>m.weight===0)).toBe(true);
});
it('queue zero has no effect on similarity and fixed preset zero/100 gives exact endpoints',()=>{
 const queue=watched(50,{watched:false,production:'B',directors:['B'],writers:['B']});const candidate=film('Only',{imdb:'8',rottenTomatoes:'95%'});
 const settings={...DEFAULT_HISTORY_SETTINGS,queue:0,presetPercent:0};
 expect(historyScore(candidate,buildHistoryProfile([...history,queue],settings))).toBe(historyScore(candidate,buildHistoryProfile(history,settings)));
 expect(rankHistoryPicks([candidate],history,20,DEFAULT_WEIGHTS,settings)[0].fitScore).toBe(Math.round(historyScore(candidate,buildHistoryProfile(history,settings))));
 expect(rankHistoryPicks([candidate],history,20,DEFAULT_WEIGHTS,{...settings,presetPercent:100})).toEqual(rankTopPicks([candidate],history));
});
it('validates finite ranges, accepts individual zeros, and rejects an all-disabled model',()=>{
 expect(normalizeHistorySettings({favorite:NaN,watched:-1,queue:9,presetPercent:Infinity})).toEqual(DEFAULT_HISTORY_SETTINGS);
 expect(normalizeHistorySettings({favorite:0,watched:0,queue:0,presetPercent:100})).toEqual({favorite:0,watched:0,queue:0,presetPercent:100});
 expect(historySettingsError({favorite:0,watched:0,queue:0,presetPercent:0})).toMatch(/At least one/);
 expect(normalizeHistorySettings({favorite:0,watched:0,queue:0,presetPercent:0})).toEqual(DEFAULT_HISTORY_SETTINGS);
 expect(historySettingsError(DEFAULT_HISTORY_SETTINGS)).toBeNull();
});

import { describe, expect, it } from 'vitest';
import { buildHistoryProfile, historyScore, rankHistoryPicks, approximateHistoryWeights } from './historyRecommendations';
import { rankTopPicks } from './recommendations';
import { emptyMovie } from './format';
import { DEFAULT_WEIGHTS } from './scoring';
import type { Candidate, Movie } from './types';
const watched=(i:number,extra:Partial<Movie>={}):Movie=>({...emptyMovie(true),title:`Watched ${i}`,imdbId:`watched-${i}`,watched:true,directors:['Director A'],writers:['Writer A'],production:'Studio A',commonSenseAge:'7+',...extra});
const film=(title:string,extra:Partial<Candidate>={}):Candidate=>({title,imdbId:title,year:2027,imdb:null,rottenTomatoes:null,commonSenseAge:'7+',studio:'Studio A',directors:['Director A'],writers:['Writer A'],awards:null,poster:null,addedAt:'2026-01-01',...extra});
const history=Array.from({length:10},(_,i)=>watched(i));
describe('watch history recommendations',()=>{
 it('requires ten distinct watched films with metadata and ignores unwatched favorites',()=>{
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
 it('gives watched favorites exactly 1.25 weight, not unwatched favorites',()=>{
  const diverse=history.map((m,i)=>i<5 ? m : {...m,directors:['B'],writers:['B'],production:'B',commonSenseAge:'12+'});
  const normal=buildHistoryProfile(diverse);const favorite=buildHistoryProfile(diverse.map((m,i)=>({...m,favorite:i===0})));
  expect(favorite.films[0].weight).toBe(1.25);
  expect(historyScore(film('A'),favorite)).toBeGreaterThan(historyScore(film('A'),normal));
  expect(buildHistoryProfile([...diverse,watched(50,{watched:false,favorite:true})])).toEqual(normal);
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

import type { Candidate, Movie } from './types';
import { rankTopPicks, type RankedPick } from './recommendations';
import { DEFAULT_WEIGHTS, scoreCandidate, type ScoringWeights } from './scoring';

export const HISTORY_THRESHOLD = 10;
export const FAVORITE_HISTORY_WEIGHT = 1.25;
export const QUEUE_HISTORY_WEIGHT = 0.5;
/** Conservative blend: 50% personal at 10 watched, 75% at 30, capped. */
export function personalBlendWeight(watchedCount: number): number {
  return watchedCount < HISTORY_THRESHOLD ? 0 : Math.min(0.75, 0.5 + (watchedCount - HISTORY_THRESHOLD) * 0.0125);
}
const norm = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const names = (items?: string[] | null) => [...new Set((items ?? []).map(norm).filter(s => s && s !== 'n/a'))];
function number(value: string | null | undefined, max: number): number | null {
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}
type Features = { director: string[]; writer: string[]; studio: string[]; age: number | null; rt: number | null; imdb: number | null };
function features(movie: Movie | Candidate): Features {
  return { director:names(movie.directors),writer:names(movie.writers),studio:names([('studio' in movie ? movie.studio : movie.production) ?? '']),age:number(movie.commonSenseAge,18),rt:number(movie.rottenTomatoes,100),imdb:number(movie.imdb,10) };
}
const usable = (f: Features) => f.director.length + f.writer.length + f.studio.length > 0 || f.age != null || f.rt != null || f.imdb != null;
export type HistoryProfile = { count: number; favoriteCount: number; queueCount: number; ready: boolean; films: Array<{features:Features;weight:number}> };
const signalWeight = (movie: Movie) => movie.favorite ? FAVORITE_HISTORY_WEIGHT : movie.watched ? 1 : QUEUE_HISTORY_WEIGHT;
export function buildHistoryProfile(movies: Movie[]): HistoryProfile {
  const unique = new Map<string,{ movie: Movie; watched: boolean }>();
  const titleKey = (movie:Movie) => `${norm(movie.title)}:${movie.year ?? ''}`;
  const knownIds = new Map(movies.filter(m=>m.imdbId).map(m=>[titleKey(m),m.imdbId!.toLowerCase()]));
  for(const movie of movies) {
    const key=movie.imdbId?.toLowerCase() ?? knownIds.get(titleKey(movie)) ?? titleKey(movie);
    const old=unique.get(key);
    // One film, strongest signal only. Watched status still counts toward
    // activation when another duplicate supplies its favorite flag.
    unique.set(key,{movie:!old || signalWeight(movie)>signalWeight(old.movie) ? movie : old.movie,watched:movie.watched || !!old?.watched});
  }
  const records=[...unique.values()].map(({movie,watched})=>({features:features(movie),weight:movie.favorite ? FAVORITE_HISTORY_WEIGHT : watched ? 1 : QUEUE_HISTORY_WEIGHT,watched})).filter(m=>usable(m.features));
  const count=records.filter(m=>m.watched).length;
  return {films:records.map(({features,weight})=>({features,weight})),count,queueCount:records.filter(m=>!m.watched).length,favoriteCount:records.filter(m=>m.weight>1).length,ready:count>=HISTORY_THRESHOLD};
}
/** Pairwise movie similarity, not a refit of global quality percentages.
 * Exact credits/studio and smooth age/review proximity learn the distribution
 * of favorite, watched and queued titles. Watching is evidence of exposure, not a positive rating. */
function similarity(a: Features,b: Features):number {
  let total=0, weight=0;
  for(const [key,w] of [['director',3],['writer',2],['studio',2]] as const) {
    if(!a[key].length || !b[key].length) continue;
    const union=new Set([...a[key],...b[key]]);
    total+=w*a[key].filter(n=>b[key].includes(n)).length/union.size;weight+=w;
  }
  for(const [key,w,scale] of [['age',2,3],['rt',1,25],['imdb',1,2]] as const) {
    const av=a[key],bv=b[key];if(av==null || bv==null)continue;
    total+=w*Math.exp(-(((av-bv)/scale)**2));weight+=w;
  }
  // Shared evidence earns confidence; one sparse field cannot dominate.
  return weight ? total/weight*Math.min(1,weight/5) : 0;
}
export function historyScore(candidate:Candidate,profile:HistoryProfile):number {
  const c=features(candidate);const totalWeight=profile.films.reduce((s,m)=>s+m.weight,0);
  return (totalWeight ? 100*profile.films.reduce((s,m)=>s+m.weight*similarity(c,m.features),0)/totalWeight : 0) - (candidate.downvoted ? 1000 : 0);
}
export function rankHistoryPicks(candidates:Candidate[],movies:Movie[],limit=20,weights:ScoringWeights=DEFAULT_WEIGHTS):RankedPick[] {
  const preset=rankTopPicks(candidates,movies,candidates.length,weights);
  const profile=buildHistoryProfile(movies);
  if(!profile.ready)return preset.slice(0,limit);
  const blend=personalBlendWeight(profile.count);
  return preset.map((c,index)=>({c,index,score:blend*historyScore(c,profile)+(1-blend)*c.fitScore})).sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,limit).map(({c,score})=>({...c,fitScore:Math.round(score)}));
}

/** Bounded local rank approximation, never written to shared weights. */
export function approximateHistoryWeights(candidates:Candidate[],movies:Movie[],initial:ScoringWeights=DEFAULT_WEIGHTS) {
  const target=rankHistoryPicks(candidates,movies,60,initial).filter(c=>!c.downvoted);
  if(target.length<2)return null;
  const watched=movies; // Approximate the existing preset context, not the learned profile.
  const context={knownDirectors:[...new Set(watched.flatMap(m=>m.directors ?? []))],knownWriters:[...new Set(watched.flatMap(m=>m.writers ?? []))]};
  const insertion=new Map(candidates.map((c,index)=>[c.imdbId ?? c.title,index]));
  const loss=(weights:ScoringWeights)=>target.map((c,index)=>({index,order:insertion.get(c.imdbId ?? c.title) ?? index,score:scoreCandidate(c,context,weights)})).sort((a,b)=>b.score-a.score || a.order-b.order).reduce((s,row,i)=>s+Math.abs(row.index-i),0);
  let weights={...initial}, error=loss(weights);
  const keys=Object.keys(weights) as Array<keyof ScoringWeights>;
  for(let pass=0;pass<3;pass++) {
    let next=weights,nextError=error;
    for(const from of keys)for(const to of keys){if(from===to || weights[from]<5)continue;const trial={...weights,[from]:weights[from]-5,[to]:weights[to]+5};const e=loss(trial);if(e<nextError){next=trial;nextError=e;}}
    if(nextError===error)break;weights=next;error=nextError;
  }
  return {weights,sampleSize:target.length,meanRankDistance:Math.round(error/target.length*10)/10};
}

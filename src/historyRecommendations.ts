import type { Candidate, Movie } from './types';
import { rankTopPicks, type RankedPick } from './recommendations';
import { DEFAULT_WEIGHTS, scoreCandidate, type ScoringWeights } from './scoring';

export type HistorySettings = { favorite: number; watched: number; queue: number; presetPercent: number };
export const DEFAULT_HISTORY_SETTINGS: HistorySettings = { favorite: 1.25, watched: 1, queue: 0.5, presetPercent: 25 };
export function historySettingsError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Recommendation settings are required.';
  const input = value as Record<string, unknown>;
  for (const key of ['favorite','watched','queue','presetPercent'] as const) {
    const n = input[key], max = key === 'presetPercent' ? 100 : 5;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) return `${key} must be between 0 and ${max}.`;
  }
  return input.favorite === 0 && input.watched === 0 && input.queue === 0 && input.presetPercent === 0 ? 'At least one recommendation signal must be greater than zero.' : null;
}
/** Corrupt persisted fields fall back individually; an entirely disabled
 * model falls back to the safe defaults. UI can reject via historySettingsError. */
export function normalizeHistorySettings(value: unknown): HistorySettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const out = {...DEFAULT_HISTORY_SETTINGS};
  for (const key of ['favorite','watched','queue','presetPercent'] as const) {
    const n = input[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= (key === 'presetPercent' ? 100 : 5)) out[key] = n;
  }
  return out.favorite === 0 && out.watched === 0 && out.queue === 0 && out.presetPercent === 0 ? {...DEFAULT_HISTORY_SETTINGS} : out;
}

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
const signalWeight = (movie: Movie, settings: HistorySettings) => Math.max(movie.favorite ? settings.favorite : 0, movie.watched ? settings.watched : settings.queue);
export function buildHistoryProfile(movies: Movie[], settings?: HistorySettings): HistoryProfile {
  const config = normalizeHistorySettings(settings);
  const unique = new Map<string,{ movie: Movie; watched: boolean; favorite: boolean; weight: number }>();
  const titleKey = (movie:Movie) => `${norm(movie.title)}:${movie.year ?? ''}`;
  const knownIds = new Map(movies.filter(m=>m.imdbId).map(m=>[titleKey(m),m.imdbId!.toLowerCase()]));
  for(const movie of movies) {
    const key=movie.imdbId?.toLowerCase() ?? knownIds.get(titleKey(movie)) ?? titleKey(movie);
    const old=unique.get(key);
    // One film, strongest signal only. Watched status still counts toward
    // activation when another duplicate supplies its favorite flag.
    const weight = signalWeight(movie,config);
    unique.set(key,{movie:!old || weight>old.weight ? movie : old.movie,watched:movie.watched || !!old?.watched,favorite:movie.favorite || !!old?.favorite,weight:Math.max(weight,old?.weight ?? 0)});
  }
  const records=[...unique.values()].map(({movie,watched,favorite,weight})=>({features:features(movie),weight,watched,favorite})).filter(m=>usable(m.features));
  const count=records.filter(m=>m.watched).length;
  return {films:records.map(({features,weight})=>({features,weight})),count,queueCount:records.filter(m=>!m.watched).length,favoriteCount:records.filter(m=>m.favorite).length,ready:count>=HISTORY_THRESHOLD};
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
export function rankHistoryPicks(candidates:Candidate[],movies:Movie[],limit=20,weights:ScoringWeights=DEFAULT_WEIGHTS,settings?:HistorySettings):RankedPick[] {
  const preset=rankTopPicks(candidates,movies,candidates.length,weights);
  const profile=buildHistoryProfile(movies,settings);
  if(!profile.ready)return preset.slice(0,limit);
  const blend=settings ? 1-normalizeHistorySettings(settings).presetPercent/100 : personalBlendWeight(profile.count);
  return preset.map((c,index)=>({c,index,score:blend*historyScore(c,profile)+(1-blend)*c.fitScore})).sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,limit).map(({c,score})=>({...c,fitScore:Math.round(score)}));
}

/** Bounded local rank approximation, never written to shared weights. */
export function approximateHistoryWeights(candidates:Candidate[],movies:Movie[],initial:ScoringWeights=DEFAULT_WEIGHTS,settings?:HistorySettings) {
  const target=rankHistoryPicks(candidates,movies,60,initial,settings).filter(c=>!c.downvoted);
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

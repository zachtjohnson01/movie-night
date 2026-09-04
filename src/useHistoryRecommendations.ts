import { useEffect, useMemo, useState } from 'react';
import type { Candidate, Movie } from './types';
import type { ScoringWeights } from './scoring';
import { rankTopPicks } from './recommendations';
import { approximateHistoryWeights, buildHistoryProfile, rankHistoryPicks } from './historyRecommendations';
export function useHistoryRecommendations(candidates:Candidate[],movies:Movie[],weights:ScoringWeights,isOwner:boolean,familyKey='',limit=20) {
 const [override,setOverride]=useState<{family:string;method:'auto'|'history'|'preset'}>({family:familyKey,method:'auto'});
 useEffect(()=>setOverride({family:familyKey,method:'auto'}),[familyKey]);
 const profile=useMemo(()=>buildHistoryProfile(movies),[movies]);
 const requested=isOwner && override.family===familyKey ? override.method : 'auto';
 const method=requested==='preset' || !profile.ready ? 'preset' : 'history';
 const preset=useMemo(()=>rankTopPicks(candidates,movies,limit,weights),[candidates,movies,limit,weights]);
 const history=useMemo(()=>rankHistoryPicks(candidates,movies,limit,weights),[candidates,movies,limit,weights]);
 const approximation=useMemo(()=>isOwner && profile.ready ? approximateHistoryWeights(candidates,movies,weights) : null,[isOwner,profile.ready,candidates,movies,weights]);
 return {profile,method,requested,picks:method==='history'?history:preset,preset,history,approximation,setMethod:(method:'auto'|'history'|'preset')=>setOverride({family:familyKey,method})};
}

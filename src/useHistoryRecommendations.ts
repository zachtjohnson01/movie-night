import { useEffect, useMemo, useState } from 'react';
import type { Candidate, Movie } from './types';
import type { ScoringWeights } from './scoring';
import { rankTopPicks } from './recommendations';
import { approximateHistoryWeights, buildHistoryProfile, rankHistoryPicks, DEFAULT_HISTORY_SETTINGS, personalBlendWeight, type HistorySettings } from './historyRecommendations';
export function useHistoryRecommendations(candidates:Candidate[],movies:Movie[],weights:ScoringWeights,isOwner:boolean,familyKey='',limit=20,settings?:HistorySettings) {
 const [draft,setDraft]=useState<HistorySettings | null>(null);
 useEffect(()=>setDraft(null),[familyKey,settings]);
 const activeSettings=draft ?? settings;
 const [override,setOverride]=useState<{family:string;method:'auto'|'history'|'preset'}>({family:familyKey,method:'auto'});
 useEffect(()=>setOverride({family:familyKey,method:'auto'}),[familyKey]);
 const profile=useMemo(()=>buildHistoryProfile(movies,activeSettings),[movies,activeSettings]);
 const requested=isOwner && override.family===familyKey ? override.method : 'auto';
 const method=requested==='preset' || !profile.ready ? 'preset' : 'history';
 const preset=useMemo(()=>rankTopPicks(candidates,movies,limit,weights),[candidates,movies,limit,weights]);
 const history=useMemo(()=>rankHistoryPicks(candidates,movies,limit,weights,activeSettings),[candidates,movies,limit,weights,activeSettings]);
 const approximation=useMemo(()=>isOwner && profile.ready ? approximateHistoryWeights(candidates,movies,weights,activeSettings) : null,[isOwner,profile.ready,candidates,movies,weights,activeSettings]);
 return {settings:activeSettings ?? {...DEFAULT_HISTORY_SETTINGS,presetPercent:Math.round((1-personalBlendWeight(profile.count))*100)}, previewing:draft!==null,setSettings:setDraft,profile,method,requested,picks:method==='history'?history:preset,preset,history,approximation,setMethod:(method:'auto'|'history'|'preset')=>setOverride({family:familyKey,method})};
}

// @vitest-environment happy-dom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({settings:{} as Record<string,unknown>,fail:false,conflict:false}));
vi.mock('./supabase',()=>({MOVIE_NIGHT_TABLE:'movie_night',isSupabaseConfigured:true,supabase:{
 from:()=>{let kind='',payload:any,expected='';const q:any={select:()=>q,is:()=>q,eq:(key:string,value:string)=>{if(key==='kind')kind=value;if(key==='movies')expected=value;return q;},update:(p:any)=>{payload=p;return q;},maybeSingle:async()=>({data:{movies:kind==='weights'?db.settings:[]},error:null}),single:async()=>({data:{movies:db.settings},error:null}),then:(resolve:any)=>{if(db.fail)return resolve({error:new Error('denied'),data:null});if(db.conflict||expected!==JSON.stringify(db.settings))return resolve({error:null,data:[]});db.settings=payload.movies;return resolve({error:null,data:[{movies:db.settings}]});}};return q;},
 channel:()=>{const c:any={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn()
}}));
import {useCandidatePool} from './useCandidatePool';
import {DEFAULT_WEIGHTS} from './scoring';
const settings={favorite:2,watched:1,queue:0.25,presetPercent:0};
beforeEach(()=>{db.settings={...DEFAULT_WEIGHTS};db.fail=false;db.conflict=false;});afterEach(cleanup);
it('saves personal settings across reload and preserves them when preset factors change',async()=>{
 const first=renderHook(useCandidatePool);await waitFor(()=>expect(first.result.current.status).toBe('empty'));
 await act(()=>first.result.current.updateHistorySettings!(settings));
 expect(db.settings).toEqual({...DEFAULT_WEIGHTS,historySettings:settings});first.unmount();
 const next=renderHook(useCandidatePool);await waitFor(()=>expect(next.result.current.historySettings).toEqual(settings));
 await act(()=>next.result.current.updateWeights({...DEFAULT_WEIGHTS,rt:25,imdb:27}));
 expect(db.settings.historySettings).toEqual(settings);expect(next.result.current.weights).not.toHaveProperty('historySettings');
});
it.each(['fail','conflict'] as const)('does not claim a save after %s',async mode=>{
 const {result}=renderHook(useCandidatePool);await waitFor(()=>expect(result.current.status).toBe('empty'));db[mode]=true;
 await act(async()=>{await expect(result.current.updateHistorySettings!(settings)).rejects.toThrow();});
 expect(result.current.historySettings).toBeUndefined();expect(db.settings).toEqual(DEFAULT_WEIGHTS);
});

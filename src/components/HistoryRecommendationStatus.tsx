import { HISTORY_THRESHOLD } from '../historyRecommendations';
import type { useHistoryRecommendations } from '../useHistoryRecommendations';
type Result=ReturnType<typeof useHistoryRecommendations>;
export default function HistoryRecommendationStatus({result,isOwner}:{result:Result;isOwner:boolean}) {
 return <section aria-label="Recommendation method" className="mx-5 my-4 rounded-2xl border border-ink-800 bg-ink-900 p-4 text-sm text-ink-300">
   <p className="font-semibold text-ink-100">{result.method==='history' ? 'Based on your family’s watch history' : 'Using the shared recommendation preset'}</p>
   <p className="mt-1 text-xs leading-relaxed text-ink-400">{result.profile.ready ? `${result.profile.count} watched films inform these suggestions. Watched favorites contribute 25% more. Watching a film does not necessarily mean you liked it.` : `${result.profile.count} of ${HISTORY_THRESHOLD} distinct watched films with usable metadata. History recommendations turn on automatically at ${HISTORY_THRESHOLD}; favorites are optional.`}</p>
   {isOwner && <details className="mt-2"><summary className="min-h-[44px] flex items-center cursor-pointer text-amber-glow">Admin: compare recommendation methods</summary>
     <label className="block">Preview method<select value={result.requested} onChange={e=>result.setMethod(e.target.value as 'auto'|'history'|'preset')} className="mt-1 min-h-[44px] w-full rounded-xl bg-ink-800 px-3"><option value="auto">Automatic</option><option value="history" disabled={!result.profile.ready}>Watch history</option><option value="preset">Shared preset</option></select></label>
     {result.profile.ready && <div className="mt-3 grid grid-cols-2 gap-3">{[['Watch history',result.history],['Shared preset',result.preset]].map(([label,picks])=><div key={label as string}><h3 className="font-semibold">{label as string}</h3><ol className="mt-2 list-decimal pl-4 space-y-1 text-xs">{(picks as Result['picks']).slice(0,5).map(c=><li key={c.imdbId ?? c.title}>{c.displayTitle ?? c.title}</li>)}</ol></div>)}</div>}
     {result.approximation && <div className="mt-3 text-xs leading-relaxed"><p className="font-semibold">Approximate preset percentages</p><p>{Object.entries(result.approximation.weights).map(([key,value])=>`${key === 'csm' ? 'Age' : key === 'imdb' ? 'IMDb' : key === 'rt' ? 'RT' : key}: ${value}%`).join(' · ')}</p><p className="mt-1">Best local approximation tested on {result.approximation.sampleSize} candidates; average rank distance {result.approximation.meanRankDistance} positions. The history model uses movie similarity and cannot be fully represented by these percentages. Preview only; shared weights are unchanged.</p></div>}
   </details>}
 </section>;
}

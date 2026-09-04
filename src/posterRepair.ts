import type { Candidate } from './types';
import { dedupKey, enrichCandidateVerified, getMovieById, OmdbError, type OmdbMoviePatch } from './omdb';
import { candidateKey } from './dedupe';

export type PosterRepairIssue = { candidate: Candidate; reason: string; suggestedId?: string };
export type PosterRepairPatch = { original: Candidate; imdbId: string; poster: string | null };
export type PosterRepairReport = { checked: number; unchanged: number; unresolved: number; failed: number; patches: PosterRepairPatch[]; review: PosterRepairIssue[]; cancelled: boolean };

export function allowedRepairPoster(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'm.media-amazon.com' && !url.port && !url.username && !url.password; } catch { return false; }
}

/** Browser image loading requires no server proxy, credentials, or arbitrary
 * URL fetch. A failed load is treated as unavailable, never proof of a 404. */
export function probeRepairPoster(url: string): Promise<boolean> {
  if (!allowedRepairPoster(url)) return Promise.resolve(false);
  return new Promise(resolve => {
    const image = new Image();
    const finish = (ok: boolean) => { clearTimeout(timer); image.onload = null; image.onerror = null; resolve(ok); };
    const timer = setTimeout(() => { image.src = ''; finish(false); }, 6000);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

export function repairIdentityMatches(candidate: Candidate, patch: OmdbMoviePatch): boolean {
  const key = (title: string) => dedupKey(title.replace(/&/g, 'and'));
  return patch.type === 'movie' && key(candidate.title) === key(patch.title) && candidate.year != null && patch.year === candidate.year;
}

type Dependencies = { byId: typeof getMovieById; byTitle: typeof enrichCandidateVerified; probe: typeof probeRepairPoster };
export async function scanPosterRepairs(candidates: Candidate[], onProgress: (done: number, total: number) => void, signal: { cancelled: boolean }, dependencies: Dependencies = {byId:getMovieById,byTitle:enrichCandidateVerified,probe:probeRepairPoster}): Promise<PosterRepairReport> {
  const report: PosterRepairReport = { checked:0,unchanged:0,unresolved:0,failed:0,patches:[],review:[],cancelled:false };
  const live = candidates.filter(c => c.removedAt == null && c.removedReason == null);
  for (const candidate of live) {
    if (signal.cancelled) { report.cancelled = true; break; }
    try {
      let identity: OmdbMoviePatch | null = null;
      if (candidate.imdbId) {
        try { identity = await dependencies.byId(candidate.imdbId); }
        catch (error) { if (!(error instanceof OmdbError) || error.kind !== 'not-found') throw error; }
        if (!identity || !repairIdentityMatches(candidate, identity)) {
          report.review.push({candidate,reason:'IMDb, title, year, or film type needs review. No identity or poster was changed.'});
          report.checked++; onProgress(report.checked,live.length); continue;
        }
      } else {
        if (candidate.year != null) identity = await dependencies.byTitle(candidate.title,{year:candidate.year});
        if (!identity || !repairIdentityMatches(candidate,identity)) {
          report.review.push({candidate,reason:'No exact title and year match was verified. Choose the correct record in the editor.'});
          report.checked++; onProgress(report.checked,live.length); continue;
        }
      }
      const currentWorks = !!candidate.poster && await dependencies.probe(candidate.poster);
      let poster = currentWorks ? candidate.poster : null;
      if (!currentWorks && identity.poster && await dependencies.probe(identity.poster)) poster = identity.poster;
      if ((!candidate.imdbId || poster !== candidate.poster) && (poster != null || !candidate.imdbId)) {
        // Never clear a failing poster automatically; a transient load failure
        // is insufficient evidence for deleting the stored URL.
        report.patches.push({original:candidate,imdbId:identity.imdbId,poster:poster ?? candidate.poster});
      } else if (poster) report.unchanged++;
      else report.unresolved++;
    } catch { report.failed++; }
    report.checked++; onProgress(report.checked,live.length);
  }
  return report;
}

/** Only persist patches if identity and poster remain unchanged since scan. */
export function applyPosterRepairs(current: Candidate[], patches: PosterRepairPatch[]): { candidates: Candidate[]; repaired: number; skipped: number } {
  let repaired = 0;
  const used = new Set<PosterRepairPatch>();
  const candidates = current.map(candidate => {
    const patch = patches.find(p => !used.has(p) && candidateKey(p.original) === candidateKey(candidate));
    if (!patch || candidate.removedAt != null || candidate.removedReason != null || candidate.poster !== patch.original.poster) return candidate;
    used.add(patch); repaired++;
    return {...candidate,imdbId:patch.imdbId,poster:patch.poster};
  });
  return {candidates,repaired,skipped:patches.length-repaired};
}

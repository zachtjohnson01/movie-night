import { useMemo } from 'react';
import { useFamilies, type FamilyRecentKey } from '../useFamilies';
import FamilyCard from './FamilyCard';
import type { AuthApi } from '../useAuth';
import type { CandidatePoolApi } from '../useCandidatePool';
import type { Candidate } from '../types';
import { pathFromRoute, pushPath } from '../router';

type Props = {
  auth: AuthApi;
  pool: CandidatePoolApi;
};

/**
 * Public family directory at `/families`. Lists every family on the
 * platform as a tappable card. Signed-in users see their own families
 * pinned to the top in a "Your families" section so they can hop to
 * any of them without going through the landing page.
 *
 * Reachable from:
 *  - The landing page (sign-in CTA + "Browse families" link)
 *  - Inside any family page via the AuthBanner menu
 *
 * Uses the same poster-strip treatment as the landing-page chooser
 * cards. Posters come from the global candidate pool index, which is
 * already loaded by the time this page renders.
 */
export default function Families({ auth, pool }: Props) {
  const { families, status } = useFamilies();
  const isSignedIn = auth.status === 'signed-in';
  const myMembershipIds = useMemo(
    () =>
      isSignedIn ? new Set(auth.memberships.map((m) => m.familyId)) : new Set(),
    [auth.memberships, isSignedIn],
  );
  const posterByKey = useMemo(
    () => buildPosterIndex(pool.candidates),
    [pool.candidates],
  );

  const yours = families.filter((f) => myMembershipIds.has(f.id));
  const others = families.filter((f) => !myMembershipIds.has(f.id));

  return (
    <div className="min-h-full flex flex-col bg-ink-950 text-ink-100">
      <header
        className="px-5 pt-2 pb-3 border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="mx-auto max-w-2xl flex items-center gap-3">
          <BackButton />
          <div className="flex-1 text-[11px] uppercase tracking-[0.22em] text-crimson-bright/90 font-bold text-center">
            Family Movie Night
          </div>
          <div className="w-11" aria-hidden="true" />
        </div>
      </header>

      <main className="flex-1 px-5 pt-6 pb-10">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-ink-100 leading-tight">
            Family directory
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            Public collections you can browse — no sign-in required.
          </p>

          {status === 'loading' && (
            <div className="mt-6 space-y-3" aria-hidden="true">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {status === 'error' && (
            <div className="mt-6 rounded-2xl bg-rose-950/40 border border-rose-900/60 px-4 py-3 text-sm text-rose-200">
              Couldn&apos;t load families. Try refreshing.
            </div>
          )}

          {status === 'local' && (
            <div className="mt-6 rounded-2xl bg-amber-glow/10 border border-amber-glow/30 px-4 py-3 text-sm text-amber-glow">
              Local mode — Supabase isn&apos;t configured, so there&apos;s
              nothing to list.
            </div>
          )}

          {(status === 'synced' || status === 'local') && (
            <>
              {yours.length > 0 && (
                <section className="mt-6">
                  <SectionLabel>Your families</SectionLabel>
                  <div className="mt-3 space-y-3">
                    {yours.map((f) => (
                      <FamilyCard
                        key={f.id}
                        family={f}
                        variant="yours"
                        posters={postersFor(f.recentWatched, posterByKey)}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-7">
                {yours.length > 0 && (
                  <SectionLabel>Everyone else</SectionLabel>
                )}
                <div className={(yours.length > 0 ? 'mt-3 ' : 'mt-6 ') + 'space-y-3'}>
                  {others.length === 0 ? (
                    <div className="text-sm text-ink-500 italic">
                      {yours.length > 0
                        ? 'No other families yet.'
                        : 'No families yet.'}
                    </div>
                  ) : (
                    others.map((f) => (
                      <FamilyCard
                        key={f.id}
                        family={f}
                        posters={postersFor(f.recentWatched, posterByKey)}
                      />
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.22em] text-ink-500 font-bold">
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="w-full h-[88px] rounded-2xl bg-ink-900 border border-ink-800 animate-pulse" />
  );
}

function BackButton() {
  function go() {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    pushPath(pathFromRoute({ kind: 'landing' }));
  }
  return (
    <button
      type="button"
      onClick={go}
      aria-label="Back"
      className="shrink-0 min-h-[44px] min-w-[44px] rounded-lg bg-ink-900/80 border border-ink-700 text-ink-200 flex items-center justify-center active:bg-ink-800"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------
// Helpers (small dupe with Landing — kept local so each page is
// self-contained and the helpers can evolve independently if needed)

function keyOf(k: FamilyRecentKey): string {
  return k.imdbId ? `id:${k.imdbId}` : `t:${k.title.toLowerCase()}`;
}

function buildPosterIndex(candidates: Candidate[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of candidates) {
    if (!c.poster) continue;
    if (c.imdbId) out.set(`id:${c.imdbId}`, c.poster);
    out.set(`t:${c.title.toLowerCase()}`, c.poster);
  }
  return out;
}

function postersFor(
  keys: FamilyRecentKey[],
  index: Map<string, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const url = index.get(keyOf(k));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 3) break;
  }
  return out;
}

import { useMemo } from 'react';
import {
  useFamilies,
  type FamilyRecentKey,
  type FamilySummary,
} from '../useFamilies';
import FamilyCard from './FamilyCard';
import type { AuthApi, FamilyMembership } from '../useAuth';
import type { CandidatePoolApi } from '../useCandidatePool';
import type { Candidate } from '../types';
import { pathFromRoute, pushPath } from '../router';

type Props = {
  auth: AuthApi;
  pool: CandidatePoolApi;
};

/**
 * Public landing page. Three modes driven by auth state:
 *
 * - **Signed-out**: cinematic poster-wall hero, value prop, sign-in
 *   CTA, "How it works" strip, and a ghost link to /families.
 * - **Signed-in, 2+ memberships**: same poster-wall hero, but the CTA
 *   slot becomes a "Welcome back, pick a family" chooser. No
 *   How-It-Works (they've already converted).
 * - **Signed-in, 1 membership**: never sees this page — App.tsx
 *   replaces the URL with /family/<slug> on mount.
 * - **Signed-in, 0 memberships**: also never sees this page — App.tsx
 *   redirects to /onboard.
 *
 * Posters in the hero come from each family's most-recently-watched
 * library entries paired with the global candidate pool (where poster
 * URLs live). Both data sources are already loaded by App.tsx, so no
 * new fetches.
 */
export default function Landing({ auth, pool }: Props) {
  const { families, status } = useFamilies();

  // Library entries don't carry posters; the global pool does. Build
  // an index keyed by both imdbId and lower-cased title so library
  // entries can resolve via either side of the join.
  const posterByKey = useMemo(
    () => buildPosterIndex(pool.candidates),
    [pool.candidates],
  );

  // Up to 9 most-recent posters across every family, deduped so a
  // movie shared by two families only appears once on the wall.
  const heroPosters = useMemo(
    () =>
      collectPosters(
        families.flatMap((f) => f.recentWatched),
        posterByKey,
        9,
      ),
    [families, posterByKey],
  );

  const familiesById = useMemo(
    () => new Map(families.map((f) => [f.id, f])),
    [families],
  );

  const isSignedIn = auth.status === 'signed-in';
  const myMemberships = isSignedIn ? auth.memberships : [];
  const showChooser = isSignedIn && myMemberships.length >= 2;

  return (
    <div className="min-h-full flex flex-col bg-ink-950 text-ink-100">
      <TopBar auth={auth} />

      <Hero
        posters={heroPosters}
        auth={auth}
        showChooser={showChooser}
        memberships={myMemberships}
        posterByKey={posterByKey}
        familiesById={familiesById}
      />

      {!showChooser && <HowItWorks />}

      {status === 'error' && (
        <div className="px-5 py-4">
          <div className="mx-auto max-w-2xl rounded-2xl bg-rose-950/40 border border-rose-900/60 px-4 py-3 text-sm text-rose-200">
            Couldn&apos;t load families. Try refreshing.
          </div>
        </div>
      )}

      {status === 'local' && (
        <div className="px-5 py-4">
          <div className="mx-auto max-w-2xl rounded-2xl bg-amber-glow/10 border border-amber-glow/30 px-4 py-3 text-sm text-amber-glow">
            Local mode — Supabase isn&apos;t configured, so there&apos;s
            nothing to sync.
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------
// Top bar

function TopBar({ auth }: { auth: AuthApi }) {
  return (
    <header
      className="px-5 pt-2 pb-3 relative z-30"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
    >
      <div className="mx-auto max-w-2xl flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-crimson-bright/90 font-bold">
          Family Movie Night
        </div>
        <AuthButton auth={auth} />
      </div>
    </header>
  );
}

function AuthButton({ auth }: { auth: AuthApi }) {
  if (auth.status === 'loading') {
    // Reserve space so the layout doesn't jump when auth resolves.
    return <div className="w-[90px] h-11" aria-hidden="true" />;
  }
  if (auth.status === 'signed-in') {
    return (
      <button
        type="button"
        onClick={auth.signOut}
        className="shrink-0 min-h-[44px] px-4 rounded-lg bg-ink-900/80 border border-ink-700 text-ink-200 font-semibold text-xs active:bg-ink-800"
      >
        Sign out
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={auth.signIn}
      className="shrink-0 min-h-[44px] px-4 rounded-lg bg-amber-glow text-ink-950 font-bold text-xs active:opacity-85"
    >
      Sign in
    </button>
  );
}

// ---------------------------------------------------------------------
// Hero (poster wall + scrim + content)

type HeroProps = {
  posters: string[];
  auth: AuthApi;
  showChooser: boolean;
  memberships: FamilyMembership[];
  posterByKey: Map<string, string>;
  familiesById: Map<string, FamilySummary>;
};

function Hero({
  posters,
  auth,
  showChooser,
  memberships,
  posterByKey,
  familiesById,
}: HeroProps) {
  return (
    <>
      <section className="relative isolate overflow-hidden">
        {/* Poster wall — 3x3 grid that fills the hero. Cells fall back
            to a dark tile when no poster is available so the wall still
            reads as a deliberate texture, not a render glitch. */}
        <div
          className="absolute inset-0 grid grid-cols-3 grid-rows-3"
          aria-hidden="true"
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="bg-ink-900 bg-cover bg-center"
              style={
                posters[i]
                  ? { backgroundImage: `url("${posters[i]}")` }
                  : undefined
              }
            />
          ))}
        </div>

        {/* Scrim — keeps text legible regardless of which posters land
            in the grid. Heavy at the bottom, light at the top, with a
            radial vignette layered on for the wider desktop layout. */}
        <div
          className="absolute inset-0 bg-gradient-to-b from-ink-950/40 via-ink-950/80 to-ink-950"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(11,11,15,0)_0%,_rgba(11,11,15,0.55)_85%)]"
          aria-hidden="true"
        />

        {/* Content sits at the bottom of the hero so the poster wall
            occupies the upper portion and headline + CTA read clearly
            against the heaviest part of the scrim. */}
        <div className="relative px-5 pt-16 pb-10 min-h-[560px] sm:min-h-[600px] flex flex-col justify-end">
          <div className="mx-auto max-w-2xl w-full">
            {showChooser ? (
              <ChooserBlock auth={auth} />
            ) : (
              <PitchBlock auth={auth} />
            )}
          </div>
        </div>
      </section>

      {showChooser && (
        <div className="px-5 pb-2 pt-2 bg-ink-950">
          <div className="mx-auto max-w-2xl space-y-3">
            {memberships.map((m) => {
              // Prefer the canonical FamilySummary (real counts +
              // recent-watched keys). Fall back to a synthesized
              // summary if the families fetch hasn't resolved yet so
              // the chooser still renders something tappable.
              const canonical = familiesById.get(m.familyId);
              const family: FamilySummary = canonical ?? {
                id: m.familyId,
                slug: m.familySlug,
                name: m.familyName,
                watchedCount: 0,
                wishlistCount: 0,
                recentWatched: [],
              };
              return (
                <FamilyCard
                  key={m.familyId}
                  variant="yours"
                  family={family}
                  posters={postersFor(family.recentWatched, posterByKey)}
                />
              );
            })}
            <div className="pt-1 flex justify-center">
              <BrowseFamiliesLink label="Browse all families" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PitchBlock({ auth }: { auth: AuthApi }) {
  return (
    <>
      <h1 className="text-[40px] leading-[1.05] font-bold text-ink-100 sm:text-5xl">
        Movies your whole
        <br />
        family will love.
      </h1>
      <p className="mt-4 text-[15px] leading-snug text-ink-300 max-w-md">
        Critic-loved picks, age-appropriate ratings, and a shared record
        of every movie night you&apos;ve watched together.
      </p>

      <div className="mt-7 flex flex-col gap-3">
        <PrimaryCta auth={auth} />
        <div className="flex justify-center">
          <BrowseFamiliesLink />
        </div>
      </div>
    </>
  );
}

function ChooserBlock({ auth }: { auth: AuthApi }) {
  const greeting = auth.name?.split(/\s+/)[0] ?? 'there';
  return (
    <>
      <div className="text-[11px] uppercase tracking-[0.22em] text-amber-glow/90 font-bold">
        Welcome back
      </div>
      <h1 className="mt-2 text-[36px] leading-[1.05] font-bold text-ink-100 sm:text-5xl">
        Hi, {greeting}.
        <br />
        Pick a family to open.
      </h1>
    </>
  );
}

function PrimaryCta({ auth }: { auth: AuthApi }) {
  if (auth.status === 'loading') {
    return (
      <div className="w-full h-14 rounded-xl bg-ink-800/70 border border-ink-700 animate-pulse" />
    );
  }
  if (auth.status === 'signed-out') {
    return (
      <button
        type="button"
        onClick={auth.signIn}
        className="w-full min-h-[56px] rounded-xl bg-amber-glow text-ink-950 font-bold text-base active:opacity-85 flex items-center justify-center gap-2 shadow-lg shadow-amber-glow/10"
      >
        <GoogleMark />
        <span>Sign in with Google</span>
      </button>
    );
  }
  // Signed-in but landed here (e.g. typed `/` directly with 2+
  // memberships and the chooser variant has its own button) — render
  // a safe fallback that points at the directory.
  const href = pathFromRoute({ kind: 'families' });
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        pushPath(href);
      }}
      className="w-full min-h-[56px] rounded-xl bg-amber-glow text-ink-950 font-bold text-base active:opacity-85 flex items-center justify-center"
    >
      Browse families
    </a>
  );
}

function BrowseFamiliesLink({
  label = 'Browse families',
}: {
  label?: string;
}) {
  const href = pathFromRoute({ kind: 'families' });
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        pushPath(href);
      }}
      className="min-h-[44px] inline-flex items-center justify-center px-3 text-sm font-semibold text-ink-300 active:text-ink-100"
    >
      {label} <span aria-hidden className="ml-1">&rarr;</span>
    </a>
  );
}

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      width="18"
      height="18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.79 2.73v2.27h2.9c1.7-1.56 2.69-3.86 2.69-6.64z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------
// How it works

function HowItWorks() {
  const steps = [
    {
      n: '1',
      title: 'Discover',
      body: "Picks built from critics, IMDb scores, and what's age-appropriate for the kids.",
    },
    {
      n: '2',
      title: 'Watch together',
      body: 'Tap "watched" when the credits roll and capture the night.',
    },
    {
      n: '3',
      title: 'Build your list',
      body: "See everything you've watched, what's up next, and what to skip.",
    },
  ];
  return (
    <section className="px-5 py-12 border-t border-ink-800/60">
      <div className="mx-auto max-w-2xl">
        <div className="text-[11px] uppercase tracking-[0.22em] text-ink-500 font-bold">
          How it works
        </div>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-7 sm:gap-5">
          {steps.map((s) => (
            <div key={s.n}>
              <div className="text-amber-glow font-bold text-3xl tabular-nums leading-none">
                {s.n}
              </div>
              <div className="mt-2 text-base font-semibold text-ink-100">
                {s.title}
              </div>
              <div className="mt-1 text-sm text-ink-400 leading-snug">
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Footer

function Footer() {
  return (
    <footer
      className="mt-auto px-5 pt-6 pb-4 border-t border-ink-800/60 text-center"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink-600 font-bold">
        Family Movie Night
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------
// Helpers

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
  return collectPosters(keys, index, 3);
}

function collectPosters(
  keys: FamilyRecentKey[],
  index: Map<string, string>,
  max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const url = index.get(keyOf(k));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

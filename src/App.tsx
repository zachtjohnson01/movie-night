import { useCallback, useEffect, useMemo, useState } from 'react';
import WatchedList from './components/WatchedList';
import Wishlist from './components/Wishlist';
import Recommendations from './components/Recommendations';
import Detail from './components/Detail';
import TabBar, { type Tab } from './components/TabBar';
import ModernWatchedList from './components/modern/WatchedList';
import ModernWishlist from './components/modern/Wishlist';
import ModernRecommendations from './components/modern/Recommendations';
import ModernDetail from './components/modern/Detail';
import ModernTabBar from './components/modern/TabBar';
import SyncBanner from './components/SyncBanner';
import AuthBanner from './components/AuthBanner';
import BulkLinkSheet from './components/BulkLinkSheet';
import EnhanceAllSheet from './components/EnhanceAllSheet';
import PoolAdmin from './components/PoolAdmin';
import UsersAdmin from './components/UsersAdmin';
import WeightsAdmin from './components/WeightsAdmin';
import Landing from './components/Landing';
import Onboarding from './components/Onboarding';
import { useMovies } from './useMovies';
import { useCandidatePool } from './useCandidatePool';
import { useAuth } from './useAuth';
import { useSwipeBack } from './useSwipeBack';
import { useUserRoles } from './useUserRoles';
import { useFamilies } from './useFamilies';
import { candidateToTemplate, emptyMovie, todayIso } from './format';
import type { Candidate, Movie } from './types';
import {
  DEFAULT_FAMILY_SLUG,
  pathFromRoute,
  pushPath,
  replacePath,
  useRoute,
} from './router';
import { JOHNSON_FAMILY_UUID } from './supabase';

// Modal-ish flows that don't deserve their own URL: creating a new
// movie, picking from the candidate pool, the owner's pool admin
// screen, the owner's scoring weights screen. List + detail views
// come from the URL via `useRoute`.
type ModalScreen =
  | { name: 'new'; template: Movie }
  | { name: 'candidate'; template: Movie; candidateTitle: string }
  | { name: 'pool' }
  | { name: 'users' }
  | { name: 'weights' };

type Design = 'classic' | 'modern';

const DESIGN_STORAGE_KEY = 'mn_design';

function readInitialDesign(): Design {
  if (typeof window === 'undefined') return 'classic';
  try {
    return window.localStorage.getItem(DESIGN_STORAGE_KEY) === 'modern'
      ? 'modern'
      : 'classic';
  } catch {
    return 'classic';
  }
}

export default function App() {
  const route = useRoute();
  const pool = useCandidatePool();
  // PR 5: useAuth no longer reads the user_roles allowlist — auth is
  // membership-driven. `useUserRoles` is still here because the legacy
  // Manage Users modal hasn't been replaced yet (that lands in PR 6).
  const userRoles = useUserRoles();
  const auth = useAuth();
  const families = useFamilies();

  // The slug owning the current view. Landing/onboard/auth-callback
  // routes don't have one; default to the Johnsons so any helpers
  // that fall back to a slug (legacy `?m=` deep-links, the openMovie
  // pushPath after picking from the candidate pool on the default
  // view) keep producing correct URLs.
  const currentSlug =
    route.kind === 'movie' ||
    route.kind === 'family' ||
    route.kind === 'settings'
      ? route.slug
      : DEFAULT_FAMILY_SLUG;

  // Resolve slug → family UUID. The default Johnsons slug short-circuits
  // to the constant from supabase.ts so the existing single-family path
  // doesn't need to wait on the families fetch. Other slugs come from
  // useFamilies once it's loaded; null until then so useMovies's effect
  // skips the query.
  const familyId =
    currentSlug === DEFAULT_FAMILY_SLUG
      ? JOHNSON_FAMILY_UUID
      : (families.families.find((f) => f.slug === currentSlug)?.id ?? null);

  // Membership for the *current* family view. Used to gate write
  // access (FAB, edit/delete, lazy poster backfill). The user might
  // be a member of multiple families — we only care about this one.
  const currentMembership =
    familyId && auth.status === 'signed-in'
      ? auth.memberships.find((m) => m.familyId === familyId) ?? null
      : null;

  const {
    movies,
    status,
    updateMovie,
    addMovie,
    deleteMovie,
    reorderWishlist,
    reload: reloadMovies,
  } = useMovies({
    familyId,
    candidates: pool.candidates,
    onUpdateCandidate: pool.updateCandidate,
    onAppendCandidates: pool.appendCandidates,
  });
  const [tab, setTab] = useState<Tab>('watched');
  const [modal, setModal] = useState<ModalScreen | null>(null);
  const [showBulkLink, setShowBulkLink] = useState(false);
  const [enhanceScope, setEnhanceScope] = useState<
    'watched' | 'wishlist' | null
  >(null);
  const [design, setDesign] = useState<Design>(readInitialDesign);
  // Preview-only state: lets the owner temporarily hide owner-exclusive
  // tools (Enhance / Enhance All) to see what the UI looks like for a
  // non-owner allowlisted user. Not persisted — resets on reload so the
  // owner can't forget they toggled it and think a feature broke.
  const [viewAsNonOwner, setViewAsNonOwner] = useState(false);
  const effectiveIsOwner = auth.isGlobalOwner && !viewAsNonOwner;

  // Write access derives from the current-family membership row.
  // Anonymous viewers, signed-in non-members, and signed-in users on a
  // family that doesn't exist all collapse to read-only.
  const canWrite = currentMembership !== null;

  useEffect(() => {
    try {
      window.localStorage.setItem(DESIGN_STORAGE_KEY, design);
    } catch {
      // localStorage unavailable (private mode, etc.) — preference just
      // won't persist across reloads. No-op.
    }
  }, [design]);

  const toggleDesign = useCallback(() => {
    setDesign((d) => (d === 'modern' ? 'classic' : 'modern'));
  }, []);

  const toggleViewAsNonOwner = useCallback(() => {
    setViewAsNonOwner((v) => !v);
  }, []);

  // Supabase processes the OAuth code via `detectSessionInUrl: true`
  // before React mounts, so by the time we land on /auth/callback the
  // session is already attached. Wait for memberships to resolve, then
  // bounce: brand-new signed-in users (no memberships) go to onboarding
  // so they can create a family; everyone else lands at the directory.
  useEffect(() => {
    if (route.kind !== 'auth-callback') return;
    if (auth.status === 'loading') return;
    if (auth.status === 'signed-in' && auth.memberships.length === 0) {
      replacePath('/onboard');
    } else {
      replacePath('/');
    }
  }, [route, auth.status, auth.memberships]);

  // Push first-time signed-in users (no memberships) to onboarding.
  // Only triggers from the landing page so a deep-link to a family
  // page or a movie detail still resolves — the public read-only view
  // works without membership and shouldn't be hijacked.
  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    if (auth.memberships.length > 0) return;
    if (route.kind === 'landing') replacePath('/onboard');
  }, [auth.status, auth.memberships, route]);

  // If the movie referenced by the URL no longer exists (deleted by
  // the other user, or the title changed and the URL didn't keep up),
  // bail back to the family view. Wait for movies to load so a cold
  // deep-link doesn't bounce while the fetch is in flight.
  useEffect(() => {
    if (route.kind !== 'movie') return;
    if (movies.length === 0) return;
    if (!movies.some((m) => m.title === route.title)) {
      replacePath(pathFromRoute({ kind: 'family', slug: route.slug }));
    }
  }, [movies, route]);

  // Pool admin and users admin are owner-only. If the user signs out,
  // isn't the owner, or toggles "view as non-owner" while either is
  // open, drop the modal.
  useEffect(() => {
    if (
      (modal?.name === 'pool' || modal?.name === 'users') &&
      !effectiveIsOwner
    ) {
      setModal(null);
    }
  }, [modal, effectiveIsOwner]);

  // Scoring weights is owner-only (not just write-allowed). Bounce out
  // if the user signs out, isn't the owner, or toggles "view as
  // non-owner" while it's open.
  useEffect(() => {
    if (modal?.name === 'weights' && !effectiveIsOwner) {
      setModal(null);
    }
  }, [modal, effectiveIsOwner]);

  // The For You tab is hidden from non-signed-in users. If they were
  // on it and lose write access (sign out, or never had it on first
  // load), bounce the active tab back to Watched so they're not
  // stranded on a tab whose button no longer exists.
  useEffect(() => {
    if (tab === 'recs' && !canWrite) {
      setTab('watched');
    }
  }, [tab, canWrite]);

  // Modals are tied to a specific family view. If the route flips to
  // landing (browser back from /family/<slug>, or replacePath after
  // OAuth callback), drop any open modal so it doesn't reappear when
  // the user navigates back into a family.
  useEffect(() => {
    if (route.kind === 'landing' && modal !== null) {
      setModal(null);
    }
  }, [route, modal]);

  const selected = useMemo(() => {
    if (route.kind !== 'movie') return null;
    return movies.find((m) => m.title === route.title) ?? null;
  }, [movies, route]);

  // Edge-swipe back: standalone PWAs lose iOS's native gesture, so we
  // synthesize one. From a modal, dismiss it. From a movie route,
  // bounce up to the family view (same destination as the in-header
  // Back button).
  useSwipeBack(
    useMemo(() => {
      if (modal !== null) return () => setModal(null);
      if (route.kind === 'movie') {
        const slug = route.slug;
        return () => pushPath(pathFromRoute({ kind: 'family', slug }));
      }
      return null;
    }, [modal, route]),
  );

  function openMovie(title: string) {
    pushPath(pathFromRoute({ kind: 'movie', slug: currentSlug, title }));
  }

  function closeMovie() {
    pushPath(pathFromRoute({ kind: 'family', slug: currentSlug }));
  }

  function openAdd() {
    if (!canWrite) return;
    const template = emptyMovie(tab === 'watched');
    setModal({ name: 'new', template });
  }

  function openPick(c: Candidate) {
    if (!canWrite) return;
    setModal({
      name: 'candidate',
      template: candidateToTemplate(c),
      candidateTitle: c.title,
    });
  }

  async function handleUpdate(originalTitle: string, updated: Movie) {
    if (!canWrite) return;
    // If the title is changing, replace the URL BEFORE kicking off the
    // updateMovie write. React 18 auto-batches: the route update from
    // replacePath and the setMovies inside updateMovie (which runs
    // before its internal await) land in the same render. Otherwise
    // React renders a transient state where movies has the renamed
    // entry but route.title still points at the old name, and the
    // bail-effect above kicks the user back to the family view.
    if (updated.title !== originalTitle) {
      replacePath(
        pathFromRoute({
          kind: 'movie',
          slug: currentSlug,
          title: updated.title,
        }),
      );
    }
    await updateMovie(originalTitle, updated);
  }

  async function handleCreate(created: Movie) {
    if (!canWrite) return;
    await addMovie(created);
    setTab(created.watched ? 'watched' : 'wishlist');
    setModal(null);
  }

  async function handleAddCandidateToWishlist(template: Movie) {
    if (!canWrite) return;
    await addMovie({ ...template, watched: false, dateWatched: null });
    setTab('wishlist');
    setModal(null);
  }

  async function handleMarkCandidateWatchedTonight(template: Movie) {
    if (!canWrite) return;
    await addMovie({ ...template, watched: true, dateWatched: todayIso() });
    setTab('watched');
    setModal(null);
  }

  async function handleMarkCandidateWatchedUndated(template: Movie) {
    if (!canWrite) return;
    await addMovie({ ...template, watched: true, dateWatched: null });
    setTab('watched');
    setModal(null);
  }

  async function handleDelete(movie: Movie) {
    if (!canWrite) return;
    await deleteMovie(movie.title);
    closeMovie();
  }

  // Signing out while scrolled deep into a Detail view left the page
  // looking blank — the mutating controls vanished and the scroll
  // position was past the end of the shrunken content. Bouncing back
  // to the family view guarantees the user lands on something visible.
  async function handleSignOut() {
    await auth.signOut();
    setModal(null);
    if (route.kind === 'movie') closeMovie();
  }

  const isModern = design === 'modern';

  if (route.kind === 'landing') {
    return <Landing auth={auth} />;
  }

  if (route.kind === 'onboard') {
    return <Onboarding auth={auth} />;
  }

  if (modal?.name === 'new') {
    const DetailComponent = isModern ? ModernDetail : Detail;
    return (
      <DetailComponent
        mode="new"
        movie={modal.template}
        canWrite={canWrite}
        familySlug={currentSlug}
        onBack={() => setModal(null)}
        onCreate={handleCreate}
      />
    );
  }

  if (modal?.name === 'pool' && effectiveIsOwner) {
    return (
      <PoolAdmin
        pool={pool}
        movies={movies}
        onBack={() => setModal(null)}
      />
    );
  }

  if (modal?.name === 'weights' && effectiveIsOwner) {
    return (
      <WeightsAdmin
        weights={pool.weights}
        onSave={pool.updateWeights}
        onBack={() => setModal(null)}
      />
    );
  }

  if (modal?.name === 'users' && effectiveIsOwner) {
    return (
      <UsersAdmin
        api={userRoles}
        currentEmail={auth.email}
        onBack={() => setModal(null)}
      />
    );
  }

  if (modal?.name === 'candidate') {
    if (isModern) {
      return (
        <ModernDetail
          mode="candidate"
          movie={modal.template}
          canWrite={canWrite}
          familySlug={currentSlug}
          library={movies}
          onBack={() => setModal(null)}
          onAddToWishlist={handleAddCandidateToWishlist}
          onMarkWatchedTonight={handleMarkCandidateWatchedTonight}
          onMarkWatchedUndated={handleMarkCandidateWatchedUndated}
          onSelectMovie={(title) => {
            setModal(null);
            openMovie(title);
          }}
        />
      );
    }
    // Live state from the pool so the downvote reflects what any user has
    // done — including the current user in an earlier session.
    const live = pool.candidates.find((c) => c.title === modal.candidateTitle);
    const canDownvote = canWrite && pool.status === 'synced' && !!live;
    const candidateTitle = modal.candidateTitle;
    return (
      <Detail
        mode="candidate"
        movie={modal.template}
        canWrite={canWrite}
        familySlug={currentSlug}
        library={movies}
        onBack={() => setModal(null)}
        onAddToWishlist={handleAddCandidateToWishlist}
        onMarkWatchedTonight={handleMarkCandidateWatchedTonight}
        onMarkWatchedUndated={handleMarkCandidateWatchedUndated}
        downvoted={!!live?.downvoted}
        onToggleDownvote={
          canDownvote
            ? () => void pool.toggleDownvote(candidateTitle)
            : undefined
        }
        onSelectMovie={(title) => {
          setModal(null);
          openMovie(title);
        }}
      />
    );
  }

  if (selected) {
    const DetailComponent = isModern ? ModernDetail : Detail;
    return (
      <DetailComponent
        mode="existing"
        movie={selected}
        canWrite={canWrite}
        isOwner={effectiveIsOwner}
        familySlug={currentSlug}
        library={movies}
        onBack={closeMovie}
        onUpdate={(updated) => handleUpdate(selected.title, updated)}
        onDelete={handleDelete}
        onSelectMovie={openMovie}
      />
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <AuthBanner
        status={auth.status}
        email={auth.email}
        name={auth.name}
        avatarUrl={auth.avatarUrl}
        onSignIn={auth.signIn}
        onSignOut={handleSignOut}
        isOwner={auth.isGlobalOwner}
        viewAsNonOwner={viewAsNonOwner}
        onToggleViewAsNonOwner={toggleViewAsNonOwner}
        design={design}
        onToggleDesign={toggleDesign}
        canManagePool={effectiveIsOwner}
        onOpenPool={() => setModal({ name: 'pool' })}
        canManageUsers={effectiveIsOwner}
        onOpenUsers={() => setModal({ name: 'users' })}
        canManageWeights={effectiveIsOwner}
        onOpenWeights={() => setModal({ name: 'weights' })}
      />
      <SyncBanner status={status} />
      <main className="flex-1 pb-tabbar">
        {isModern ? (
          <>
            {tab === 'watched' && (
              <ModernWatchedList
                movies={movies}
                canWrite={canWrite}
                onSelect={(m) => openMovie(m.title)}
                onAdd={openAdd}
              />
            )}
            {tab === 'wishlist' && (
              <ModernWishlist
                movies={movies}
                canWrite={canWrite}
                onSelect={(m) => openMovie(m.title)}
                onAdd={openAdd}
              />
            )}
            {tab === 'recs' && canWrite && (
              <ModernRecommendations
                movies={movies}
                pool={pool}
                isOwner={effectiveIsOwner}
                onSelectPick={openPick}
              />
            )}
          </>
        ) : (
          <>
            {tab === 'watched' && (
              <WatchedList
                movies={movies}
                canWrite={canWrite}
                isOwner={effectiveIsOwner}
                onSelect={(m) => openMovie(m.title)}
                onAdd={openAdd}
                onBulkLink={() => setShowBulkLink(true)}
                onEnhanceAll={() => setEnhanceScope('watched')}
              />
            )}
            {tab === 'wishlist' && (
              <Wishlist
                movies={movies}
                canWrite={canWrite}
                isOwner={effectiveIsOwner}
                onSelect={(m) => openMovie(m.title)}
                onAdd={openAdd}
                onEnhanceAll={() => setEnhanceScope('wishlist')}
                onReorder={reorderWishlist}
              />
            )}
            {tab === 'recs' && canWrite && (
              <Recommendations
                movies={movies}
                pool={pool}
                isOwner={effectiveIsOwner}
                onSelectPick={openPick}
                reloadMovies={reloadMovies}
              />
            )}
          </>
        )}
      </main>
      {isModern ? (
        <ModernTabBar tab={tab} onChange={setTab} canSeeRecs={canWrite} />
      ) : (
        <TabBar tab={tab} onChange={setTab} canSeeRecs={canWrite} />
      )}
      {showBulkLink && (
        <BulkLinkSheet
          movies={movies}
          onUpdateMovie={updateMovie}
          onClose={() => setShowBulkLink(false)}
        />
      )}
      {enhanceScope && (
        <EnhanceAllSheet
          scope={enhanceScope}
          movies={movies.filter((m) =>
            enhanceScope === 'watched' ? m.watched : !m.watched,
          )}
          onUpdateMovie={updateMovie}
          onClose={() => setEnhanceScope(null)}
        />
      )}
    </div>
  );
}

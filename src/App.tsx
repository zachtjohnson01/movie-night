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
import WeightsAdmin from './components/WeightsAdmin';
import { useMovies } from './useMovies';
import { useCandidatePool } from './useCandidatePool';
import { useAuth } from './useAuth';
import { useSwipeBack } from './useSwipeBack';
import { candidateToTemplate, emptyMovie, todayIso } from './format';
import type { Candidate, Movie } from './types';

type Screen =
  | { name: 'list' }
  | { name: 'detail'; title: string }
  | { name: 'new'; template: Movie }
  // `candidateTitle` keeps us anchored to the pool row so the Detail
  // downvote toggle writes back to the right entry. The template itself
  // is a Movie shape for the existing Detail component to consume.
  | { name: 'candidate'; template: Movie; candidateTitle: string }
  | { name: 'pool' }
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

/**
 * Read the `?m=<title>` deep-link param from the URL on first render.
 * The title can't be resolved synchronously — movies haven't loaded
 * from Supabase yet — so we stash it and match once `movies` arrives.
 */
function readPendingDeepLink(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const param = new URL(window.location.href).searchParams.get('m');
    return param ? param : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite the URL's `?m=` param without reloading. Used when navigating
 * between list and detail views so a refresh or back-button keeps the
 * right state, and shared URLs still work.
 */
function setDeepLinkParam(title: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (title) url.searchParams.set('m', title);
    else url.searchParams.delete('m');
    const next = url.pathname + (url.search ? url.search : '') + url.hash;
    window.history.replaceState(null, '', next);
  } catch {
    // URL manipulation can fail in odd sandboxes — just no-op.
  }
}

export default function App() {
  const pool = useCandidatePool();
  const {
    movies,
    status,
    updateMovie,
    addMovie,
    deleteMovie,
    reorderWishlist,
    reload: reloadMovies,
  } = useMovies({
    candidates: pool.candidates,
    onUpdateCandidate: pool.updateCandidate,
    onAppendCandidates: pool.appendCandidates,
  });
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('watched');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [showBulkLink, setShowBulkLink] = useState(false);
  const [enhanceScope, setEnhanceScope] = useState<
    'watched' | 'wishlist' | null
  >(null);
  const [design, setDesign] = useState<Design>(readInitialDesign);
  // A shared `?m=<title>` link was opened: hold the requested title
  // until `movies` loads, then match and switch to the detail view.
  // Cleared to null once consumed (hit or miss).
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(
    readPendingDeepLink,
  );
  // Preview-only state: lets the owner temporarily hide owner-exclusive
  // tools (Enhance / Enhance All) to see what the UI looks like for a
  // non-owner allowlisted user. Not persisted — resets on reload so the
  // owner can't forget they toggled it and think a feature broke.
  const [viewAsNonOwner, setViewAsNonOwner] = useState(false);
  const effectiveIsOwner = auth.isOwner && !viewAsNonOwner;

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

  // If the selected movie disappears (deleted by the other user, or
  // renamed), bail back to the list view.
  useEffect(() => {
    if (screen.name !== 'detail') return;
    if (!movies.some((m) => m.title === screen.title)) {
      setScreen({ name: 'list' });
    }
  }, [movies, screen]);

  // Resolve a pending `?m=<title>` deep link once movies have loaded.
  // If the title matches, open that movie's detail view; otherwise
  // just clear the param so the URL reflects the actual state.
  useEffect(() => {
    if (!pendingDeepLink) return;
    if (movies.length === 0) return;
    const match = movies.find((m) => m.title === pendingDeepLink);
    if (match) {
      setScreen({ name: 'detail', title: match.title });
    } else {
      setDeepLinkParam(null);
    }
    setPendingDeepLink(null);
  }, [pendingDeepLink, movies]);

  // Mirror the current screen into the URL so refresh / browser-back /
  // Shared copy keep working. Only list ↔ detail participates; ephemeral
  // flows (new / candidate / pool) don't persist in the URL.
  useEffect(() => {
    if (pendingDeepLink) return;
    if (screen.name === 'detail') setDeepLinkParam(screen.title);
    else if (screen.name === 'list') setDeepLinkParam(null);
  }, [screen, pendingDeepLink]);

  // Admin screens are owner-only. If the user signs out, isn't the owner,
  // or toggles "view as non-owner" while on the pool admin screen, bounce
  // them back to the list.
  useEffect(() => {
    if (screen.name === 'pool' && !effectiveIsOwner) {
      setScreen({ name: 'list' });
    }
  }, [screen, effectiveIsOwner]);

  // The For You tab is hidden from non-signed-in users. If they were on
  // it and lose write access (sign out, or never had it on first load),
  // bounce the active tab back to Watched so they're not stranded on a
  // tab whose button no longer exists.
  useEffect(() => {
    if (tab === 'recs' && !auth.canWrite) {
      setTab('watched');
    }
  }, [tab, auth.canWrite]);

  // Scoring weights is owner-only (not just write-allowed). Bounce out
  // if the user signs out, isn't the owner, or toggles "view as
  // non-owner" while it's open.
  useEffect(() => {
    if (screen.name === 'weights' && !effectiveIsOwner) {
      setScreen({ name: 'list' });
    }
  }, [screen, effectiveIsOwner]);

  const selected = useMemo(() => {
    if (screen.name !== 'detail') return null;
    return movies.find((m) => m.title === screen.title) ?? null;
  }, [movies, screen]);

  // Edge-swipe back: standalone PWAs lose iOS's native gesture, so we
  // synthesize one. Any non-list screen swipes back to the list — same
  // destination as every in-header Back button.
  useSwipeBack(
    useMemo(
      () =>
        screen.name === 'list' ? null : () => setScreen({ name: 'list' }),
      [screen.name],
    ),
  );

  function openAdd() {
    if (!auth.canWrite) return;
    const template = emptyMovie(tab === 'watched');
    setScreen({ name: 'new', template });
  }

  function openPick(c: Candidate) {
    if (!auth.canWrite) return;
    setScreen({
      name: 'candidate',
      template: candidateToTemplate(c),
      candidateTitle: c.title,
    });
  }

  async function handleUpdate(originalTitle: string, updated: Movie) {
    if (!auth.canWrite) return;
    // If the title is changing, update `screen.title` BEFORE kicking
    // off the updateMovie write. React 18 auto-batches state updates
    // within the same synchronous chunk, so setting screen here and
    // the setMovies inside updateMovie (which runs before its internal
    // await) land in the same render. Otherwise React renders a
    // transient state where `movies` has the renamed movie but
    // `screen.title` still points at the old name, and the
    // list-bailout effect below fires and kicks the user back to the
    // list.
    if (updated.title !== originalTitle) {
      setScreen({ name: 'detail', title: updated.title });
    }
    await updateMovie(originalTitle, updated);
  }

  async function handleCreate(created: Movie) {
    if (!auth.canWrite) return;
    await addMovie(created);
    setTab(created.watched ? 'watched' : 'wishlist');
    setScreen({ name: 'list' });
  }

  async function handleAddCandidateToWishlist(template: Movie) {
    if (!auth.canWrite) return;
    await addMovie({ ...template, watched: false, dateWatched: null });
    setTab('wishlist');
    setScreen({ name: 'list' });
  }

  async function handleMarkCandidateWatchedTonight(template: Movie) {
    if (!auth.canWrite) return;
    await addMovie({ ...template, watched: true, dateWatched: todayIso() });
    setTab('watched');
    setScreen({ name: 'list' });
  }

  async function handleMarkCandidateWatchedUndated(template: Movie) {
    if (!auth.canWrite) return;
    await addMovie({ ...template, watched: true, dateWatched: null });
    setTab('watched');
    setScreen({ name: 'list' });
  }

  async function handleDelete(movie: Movie) {
    if (!auth.canWrite) return;
    await deleteMovie(movie.title);
    setScreen({ name: 'list' });
  }

  // Signing out while scrolled deep into a Detail view left the page
  // looking blank — the mutating controls vanished and the scroll
  // position was past the end of the shrunken content. Bouncing back
  // to the list view guarantees the user lands on something visible.
  async function handleSignOut() {
    await auth.signOut();
    setScreen({ name: 'list' });
  }

  const isModern = design === 'modern';

  if (screen.name === 'new') {
    const DetailComponent = isModern ? ModernDetail : Detail;
    return (
      <DetailComponent
        mode="new"
        movie={screen.template}
        canWrite={auth.canWrite}
        onBack={() => setScreen({ name: 'list' })}
        onCreate={handleCreate}
      />
    );
  }

  if (screen.name === 'pool' && effectiveIsOwner) {
    return (
      <PoolAdmin
        pool={pool}
        movies={movies}
        onBack={() => setScreen({ name: 'list' })}
      />
    );
  }

  if (screen.name === 'weights' && effectiveIsOwner) {
    return (
      <WeightsAdmin
        weights={pool.weights}
        onSave={pool.updateWeights}
        onBack={() => setScreen({ name: 'list' })}
      />
    );
  }

  if (screen.name === 'candidate') {
    if (isModern) {
      return (
        <ModernDetail
          mode="candidate"
          movie={screen.template}
          canWrite={auth.canWrite}
          library={movies}
          onBack={() => setScreen({ name: 'list' })}
          onAddToWishlist={handleAddCandidateToWishlist}
          onMarkWatchedTonight={handleMarkCandidateWatchedTonight}
          onMarkWatchedUndated={handleMarkCandidateWatchedUndated}
          onSelectMovie={(title) => setScreen({ name: 'detail', title })}
        />
      );
    }
    // Live state from the pool so the downvote reflects what any user has
    // done — including the current user in an earlier session.
    const live = pool.candidates.find((c) => c.title === screen.candidateTitle);
    const canDownvote = auth.canWrite && pool.status === 'synced' && !!live;
    return (
      <Detail
        mode="candidate"
        movie={screen.template}
        canWrite={auth.canWrite}
        library={movies}
        onBack={() => setScreen({ name: 'list' })}
        onAddToWishlist={handleAddCandidateToWishlist}
        onMarkWatchedTonight={handleMarkCandidateWatchedTonight}
        onMarkWatchedUndated={handleMarkCandidateWatchedUndated}
        downvoted={!!live?.downvoted}
        onToggleDownvote={
          canDownvote
            ? () => void pool.toggleDownvote(screen.candidateTitle)
            : undefined
        }
        onSelectMovie={(title) => setScreen({ name: 'detail', title })}
      />
    );
  }

  if (selected) {
    const DetailComponent = isModern ? ModernDetail : Detail;
    return (
      <DetailComponent
        mode="existing"
        movie={selected}
        canWrite={auth.canWrite}
        isOwner={effectiveIsOwner}
        library={movies}
        onBack={() => setScreen({ name: 'list' })}
        onUpdate={(updated) => handleUpdate(selected.title, updated)}
        onDelete={handleDelete}
        onSelectMovie={(title) => setScreen({ name: 'detail', title })}
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
        isOwner={auth.isOwner}
        viewAsNonOwner={viewAsNonOwner}
        onToggleViewAsNonOwner={toggleViewAsNonOwner}
        design={design}
        onToggleDesign={toggleDesign}
        canManagePool={effectiveIsOwner}
        onOpenPool={() => setScreen({ name: 'pool' })}
        canManageWeights={effectiveIsOwner}
        onOpenWeights={() => setScreen({ name: 'weights' })}
      />
      <SyncBanner status={status} />
      <main className="flex-1 pb-tabbar">
        {isModern ? (
          <>
            {tab === 'watched' && (
              <ModernWatchedList
                movies={movies}
                canWrite={auth.canWrite}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
              />
            )}
            {tab === 'wishlist' && (
              <ModernWishlist
                movies={movies}
                canWrite={auth.canWrite}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
              />
            )}
            {tab === 'recs' && auth.canWrite && (
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
                canWrite={auth.canWrite}
                isOwner={effectiveIsOwner}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
                onBulkLink={() => setShowBulkLink(true)}
                onEnhanceAll={() => setEnhanceScope('watched')}
              />
            )}
            {tab === 'wishlist' && (
              <Wishlist
                movies={movies}
                canWrite={auth.canWrite}
                isOwner={effectiveIsOwner}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
                onEnhanceAll={() => setEnhanceScope('wishlist')}
                onReorder={reorderWishlist}
              />
            )}
            {tab === 'recs' && auth.canWrite && (
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
        <ModernTabBar tab={tab} onChange={setTab} canSeeRecs={auth.canWrite} />
      ) : (
        <TabBar tab={tab} onChange={setTab} canSeeRecs={auth.canWrite} />
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

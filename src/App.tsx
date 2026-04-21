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
import { useMovies } from './useMovies';
import { useAuth } from './useAuth';
import { candidateToTemplate, emptyMovie } from './format';
import type { Candidate, Movie } from './types';

type Screen =
  | { name: 'list' }
  | { name: 'detail'; title: string }
  | { name: 'new'; template: Movie };

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
  const {
    movies,
    status,
    updateMovie,
    addMovie,
    deleteMovie,
    reorderWishlist,
    reload: reloadMovies,
  } = useMovies();
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('watched');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [showBulkLink, setShowBulkLink] = useState(false);
  const [enhanceScope, setEnhanceScope] = useState<
    'watched' | 'wishlist' | null
  >(null);
  const [design, setDesign] = useState<Design>(readInitialDesign);

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

  // If the selected movie disappears (deleted by the other user, or
  // renamed), bail back to the list view.
  useEffect(() => {
    if (screen.name !== 'detail') return;
    if (!movies.some((m) => m.title === screen.title)) {
      setScreen({ name: 'list' });
    }
  }, [movies, screen]);

  const selected = useMemo(() => {
    if (screen.name !== 'detail') return null;
    return movies.find((m) => m.title === screen.title) ?? null;
  }, [movies, screen]);

  function openAdd() {
    if (!auth.canWrite) return;
    const template = emptyMovie(tab === 'watched');
    setScreen({ name: 'new', template });
  }

  function openPick(c: Candidate) {
    if (!auth.canWrite) return;
    setScreen({ name: 'new', template: candidateToTemplate(c) });
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

  if (selected) {
    const DetailComponent = isModern ? ModernDetail : Detail;
    return (
      <DetailComponent
        mode="existing"
        movie={selected}
        canWrite={auth.canWrite}
        isOwner={auth.isOwner}
        onBack={() => setScreen({ name: 'list' })}
        onUpdate={(updated) => handleUpdate(selected.title, updated)}
        onDelete={handleDelete}
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
                design={design}
                onToggleDesign={toggleDesign}
              />
            )}
            {tab === 'wishlist' && (
              <ModernWishlist
                movies={movies}
                canWrite={auth.canWrite}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
                design={design}
                onToggleDesign={toggleDesign}
              />
            )}
            {tab === 'recs' && (
              <ModernRecommendations
                movies={movies}
                canWrite={auth.canWrite}
                onSelectPick={openPick}
                design={design}
                onToggleDesign={toggleDesign}
              />
            )}
          </>
        ) : (
          <>
            {tab === 'watched' && (
              <WatchedList
                movies={movies}
                canWrite={auth.canWrite}
                isOwner={auth.isOwner}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
                onBulkLink={() => setShowBulkLink(true)}
                onEnhanceAll={() => setEnhanceScope('watched')}
                design={design}
                onToggleDesign={toggleDesign}
              />
            )}
            {tab === 'wishlist' && (
              <Wishlist
                movies={movies}
                canWrite={auth.canWrite}
                isOwner={auth.isOwner}
                onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
                onAdd={openAdd}
                onEnhanceAll={() => setEnhanceScope('wishlist')}
                onReorder={reorderWishlist}
                design={design}
                onToggleDesign={toggleDesign}
              />
            )}
            {tab === 'recs' && (
              <Recommendations
                movies={movies}
                canWrite={auth.canWrite}
                onSelectPick={openPick}
                reloadMovies={reloadMovies}
              />
            )}
          </>
        )}
      </main>
      {isModern ? (
        <ModernTabBar tab={tab} onChange={setTab} />
      ) : (
        <TabBar tab={tab} onChange={setTab} />
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

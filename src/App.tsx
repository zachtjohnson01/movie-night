import { useEffect, useMemo, useState } from 'react';
import WatchedList from './components/WatchedList';
import Wishlist from './components/Wishlist';
import Detail from './components/Detail';
import TabBar, { type Tab } from './components/TabBar';
import SyncBanner from './components/SyncBanner';
import { useMovies } from './useMovies';
import { emptyMovie } from './format';
import type { Movie } from './types';

type Screen =
  | { name: 'list' }
  | { name: 'detail'; title: string }
  | { name: 'new'; template: Movie };

export default function App() {
  const { movies, status, updateMovie, addMovie, deleteMovie } = useMovies();
  const [tab, setTab] = useState<Tab>('watched');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

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
    const template = emptyMovie(tab === 'watched');
    setScreen({ name: 'new', template });
  }

  async function handleUpdate(originalTitle: string, updated: Movie) {
    await updateMovie(originalTitle, updated);
    // Follow the movie if its title changed.
    if (updated.title !== originalTitle) {
      setScreen({ name: 'detail', title: updated.title });
    }
  }

  async function handleCreate(created: Movie) {
    await addMovie(created);
    setTab(created.watched ? 'watched' : 'wishlist');
    setScreen({ name: 'list' });
  }

  async function handleDelete(movie: Movie) {
    await deleteMovie(movie.title);
    setScreen({ name: 'list' });
  }

  if (screen.name === 'new') {
    return (
      <Detail
        mode="new"
        movie={screen.template}
        onBack={() => setScreen({ name: 'list' })}
        onCreate={handleCreate}
      />
    );
  }

  if (selected) {
    return (
      <Detail
        mode="existing"
        movie={selected}
        onBack={() => setScreen({ name: 'list' })}
        onUpdate={(updated) => handleUpdate(selected.title, updated)}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <SyncBanner status={status} />
      <main className="flex-1 pb-tabbar">
        {tab === 'watched' ? (
          <WatchedList
            movies={movies}
            onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
            onAdd={openAdd}
          />
        ) : (
          <Wishlist
            movies={movies}
            onSelect={(m) => setScreen({ name: 'detail', title: m.title })}
            onAdd={openAdd}
          />
        )}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}

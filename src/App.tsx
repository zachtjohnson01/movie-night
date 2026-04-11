import { useEffect, useMemo, useState } from 'react';
import seed from '../movies.json';
import type { Movie } from './types';
import WatchedList from './components/WatchedList';
import Wishlist from './components/Wishlist';
import Detail from './components/Detail';
import TabBar, { type Tab } from './components/TabBar';

const SEED: Movie[] = seed as Movie[];

export default function App() {
  const [movies, setMovies] = useState<Movie[]>(SEED);
  const [tab, setTab] = useState<Tab>('watched');
  // Identify a selected movie by its original title (stable within a session).
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);

  // If the user edits a movie and renames it, keep the selection in sync.
  useEffect(() => {
    if (selectedTitle === null) return;
    if (!movies.some((m) => m.title === selectedTitle)) {
      setSelectedTitle(null);
    }
  }, [movies, selectedTitle]);

  const selected = useMemo(
    () =>
      selectedTitle === null
        ? null
        : movies.find((m) => m.title === selectedTitle) ?? null,
    [movies, selectedTitle],
  );

  function updateMovie(originalTitle: string, updated: Movie) {
    setMovies((prev) =>
      prev.map((m) => (m.title === originalTitle ? updated : m)),
    );
    // Follow the movie if its title changed.
    setSelectedTitle(updated.title);
  }

  if (selected) {
    return (
      <Detail
        movie={selected}
        allMovies={movies}
        onBack={() => setSelectedTitle(null)}
        onUpdate={(updated) => updateMovie(selected.title, updated)}
      />
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 pb-tabbar">
        {tab === 'watched' ? (
          <WatchedList
            movies={movies}
            onSelect={(m) => setSelectedTitle(m.title)}
          />
        ) : (
          <Wishlist
            movies={movies}
            onSelect={(m) => setSelectedTitle(m.title)}
          />
        )}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}

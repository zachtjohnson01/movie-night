import { useState } from 'react';
import seed from '../movies.json';
import type { Movie } from './types';
import WatchedList from './components/WatchedList';
import Wishlist from './components/Wishlist';
import TabBar, { type Tab } from './components/TabBar';

const SEED: Movie[] = seed as Movie[];

export default function App() {
  const [movies] = useState<Movie[]>(SEED);
  const [tab, setTab] = useState<Tab>('watched');

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 pb-tabbar">
        {tab === 'watched' ? (
          <WatchedList movies={movies} onSelect={() => {}} />
        ) : (
          <Wishlist movies={movies} onSelect={() => {}} />
        )}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}

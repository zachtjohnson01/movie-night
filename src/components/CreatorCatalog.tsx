import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Candidate, Movie } from '../types';
import { CreatorCatalogContext, creatorCatalogMatches, type CreatorSelection } from '../creatorCatalog';
import Detail from './Detail';
import CatalogMovieCard from './CatalogMovieCard';
import CatalogAwards from './CatalogAwards';

type Layer = { selection: CreatorSelection; movie?: Movie };
export default function CreatorCatalog({ pool, library, familySlug, children, onOpenChange, modern = false }: {
  pool: Candidate[]; library: Movie[]; familySlug: string; children: ReactNode; onOpenChange?: (open: boolean) => void; modern?: boolean;
}) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const layer = layers[layers.length - 1];
  const isOpen = !!layer;
  useEffect(() => { onOpenChange?.(isOpen); return () => onOpenChange?.(false); }, [isOpen, onOpenChange]);
  useEffect(() => {
    if (!isOpen) return;
    const element = dialog.current;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousFocus = document.activeElement as HTMLElement | null;
    const body = document.body;
    const previousBody = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow };
    const previousOverflow = document.documentElement.style.overflow;
    Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, left: `-${scrollX}px`, width: '100%', overflow: 'hidden' });
    document.documentElement.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      element?.close();
      Object.assign(body.style, previousBody);
      document.documentElement.style.overflow = previousOverflow;
      previousFocus?.focus({preventScroll:true});
      window.scrollTo(scrollX, scrollY);
    };
  }, [isOpen]);
  function back() {
    setLayers(current => current[current.length - 1]?.movie
      ? current.map((item,i) => i === current.length - 1 ? {selection:item.selection} : item)
      : current.slice(0,-1));
  }
  const matches = layer ? creatorCatalogMatches(pool, library, layer.selection) : [];
  return <CreatorCatalogContext.Provider value={selection => setLayers(current => [...current, {selection}])}>
    {children}
    {layer && <dialog ref={dialog} aria-label={layer.movie ? `${layer.movie.title} details` : `More films: ${layer.selection.name}`} onCancel={e => { e.preventDefault(); back(); }} className="fixed inset-0 m-auto flex w-[calc(100%_-_2rem)] max-w-xl max-h-[76dvh] flex-col rounded-3xl border border-amber-glow/30 bg-ink-950 p-0 text-ink-100 shadow-2xl shadow-black/60 backdrop:bg-black/75 overflow-hidden">
      <div className="shrink-0 flex items-start justify-between gap-3 bg-gradient-to-br from-amber-glow/15 via-ink-900 to-ink-950 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-amber-glow">{layer.selection.role}</p>
          <h2 className="mt-1 text-2xl font-bold break-words">{layer.selection.name}</h2>
        </div>
        <button type="button" autoFocus onClick={back} aria-label={layer.movie ? 'Back to results' : layers.length > 1 ? 'Back to previous movie' : 'Close catalog'} className="min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-xl text-ink-300 active:bg-ink-800"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y" style={{WebkitOverflowScrolling:'touch'}}>
      {layer.movie ? <Detail key={layer.movie.imdbId ?? `${layer.movie.title}:${layer.movie.year}`} mode="candidate" movie={layer.movie} canWrite={false} familySlug={familySlug} onBack={back} onAddToWishlist={() => {}} onMarkWatchedTonight={() => {}} onMarkWatchedUndated={() => {}} /> : <section className="p-5">
        <CatalogAwards films={[layer.selection.origin, ...matches]} />
        {matches.length === 0 ? <p className="py-8 text-ink-300">No other matching films are in the catalog yet.</p> : <ul className="mt-4 divide-y divide-ink-800">{matches.map(movie => <li key={movie.imdbId ?? `${movie.title}:${movie.year}`}>
          <CatalogMovieCard movie={movie} modern={modern} onSelect={() => setLayers(current => current.map((item,i) => i === current.length - 1 ? {...item,movie} : item))} />
        </li>)}</ul>}
      </section>}
      </div>
    </dialog>}
  </CreatorCatalogContext.Provider>;
}

import { createContext, useContext } from 'react';
import type { Candidate, Movie } from './types';
import { candidateToTemplate } from './format';
export type CreatorRole = 'director' | 'writer' | 'studio';
export type CreatorSelection = { role: CreatorRole; name: string; origin: Movie };
export const CreatorCatalogContext = createContext<((selection: CreatorSelection) => void) | undefined>(undefined);
export const useCreatorCatalog = () => useContext(CreatorCatalogContext);
export const normalizeCreator = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const identity = (m: Movie) => m.imdbId ? `imdb:${m.imdbId.toLowerCase()}` : `title:${normalizeCreator(m.title)}:${m.year ?? ''}`;
export function creatorCatalogMatches(pool: Candidate[], library: Movie[], selection: CreatorSelection): Movie[] {
  const activeIds = new Set(pool.filter(c => c.removedAt == null && c.removedReason == null).map(c => identity(candidateToTemplate(c))));
  const removed = new Set(pool.filter(c => (c.removedAt != null || c.removedReason != null)).map(c => identity(candidateToTemplate(c))).filter(key => !activeIds.has(key)));
  const seen = new Set<string>([identity(selection.origin)]);
  const found: Movie[] = [];
  for (const movie of [...pool.filter(c => c.removedAt == null && c.removedReason == null).map(candidateToTemplate), ...library]) {
    const key = identity(movie);
    const names = selection.role === 'director' ? movie.directors : selection.role === 'writer' ? movie.writers : movie.production ? [movie.production] : [];
    const isOrigin = movie.imdbId && selection.origin.imdbId ? movie.imdbId.toLowerCase() === selection.origin.imdbId.toLowerCase() : normalizeCreator(movie.title) === normalizeCreator(selection.origin.title) && movie.year === selection.origin.year;
    if (isOrigin || seen.has(key) || removed.has(key) || !names?.some(n => normalizeCreator(n) === normalizeCreator(selection.name))) continue;
    seen.add(key);
    found.push(movie);
  }
  return found.sort((a,b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
}

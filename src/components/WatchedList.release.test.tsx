// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Classic from './WatchedList';
import Modern from './modern/WatchedList';
import { emptyMovie } from '../format';
vi.mock('./BuildStamp', () => ({default:()=>null}));
vi.mock('./MoviePoster', () => ({default:()=>null}));
vi.mock('./modern/ModernPoster', () => ({default:()=>null}));
afterEach(cleanup);
for (const [skin, Component] of [['classic', Classic], ['modern', Modern]] as const) {
 it(`${skin} distinguishes original release date from family watched date`, () => {
  const movie = {...emptyMovie(true), id:'a', title:'Example', watched:true, favorite:true, dateWatched:'2026-09-04', releaseDate:'2000-01-02'};
  render(<Component movies={[movie]} canWrite={false} isOwner={false} onSelect={()=>{}} onAdd={()=>{}} onBulkLink={()=>{}} onEnhanceAll={()=>{}}/>);
  expect(screen.getAllByText('Watched Sep 4, 2026').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Released Jan 2, 2000').length).toBeGreaterThan(0);
 });
 it(`${skin} does not invent an original release date`, () => {
  render(<Component movies={[{...emptyMovie(true), id:'b', title:'Unknown', watched:true}]} canWrite={false} isOwner={false} onSelect={()=>{}} onAdd={()=>{}} onBulkLink={()=>{}} onEnhanceAll={()=>{}}/>);
  expect(screen.getByText('Watched date unknown')).toBeTruthy();
  expect(screen.queryByLabelText(/Release date/)).toBeNull();
 });
}

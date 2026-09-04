// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Wishlist from './Wishlist';
import ModernWishlist from './modern/Wishlist';
import { emptyMovie } from '../format';
const props={canWrite:false,isOwner:false,onAdd:()=>{},onEnhanceAll:()=>{},onReorder:()=>{}};
beforeEach(()=>{vi.stubGlobal('__BUILD_COMMIT__','test');vi.stubGlobal('__BUILD_TIME__','2026-09-04');});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each([{Component:Wishlist,name:'classic'},{Component:ModernWishlist,name:'modern'}])('shows exact future date in $name Up Next and opens unchanged queued movie',({Component})=>{
 const movie={...emptyMovie(false),title:'Future movie',year:2999,releaseDate:'2999-10-23'};const onSelect=vi.fn();
 render(<Component {...props} movies={[movie]} onSelect={onSelect}/>);
 expect(screen.getByLabelText('Upcoming · Oct 23, 2999')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Future movie/}));
 expect(onSelect).toHaveBeenCalledWith(movie);expect(movie.watched).toBe(false);
});
it.each([{Component:Wishlist,name:'classic'},{Component:ModernWishlist,name:'modern'}])('does not invent date from year alone in $name Up Next',({Component})=>{
 render(<Component {...props} movies={[{...emptyMovie(false),title:'Year only',year:2999}]} onSelect={()=>{}}/>);
 expect(screen.queryByText(/Upcoming ·|Release date ·/)).toBeNull();
});

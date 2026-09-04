// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CatalogMovieCard from './CatalogMovieCard';
import { emptyMovie } from '../format';
afterEach(cleanup);
it.each([false,true])('shows real poster, age, scores, studio and release date (modern=%s)',modern=>{
 const onSelect=vi.fn();
 render(<CatalogMovieCard modern={modern} onSelect={onSelect} movie={{...emptyMovie(false),title:'Example',year:2025,poster:'https://example.com/poster.jpg',commonSenseAge:'7+',rottenTomatoes:'94%',imdb:'8.2',production:'Studio',releaseDate:'2025-06-20'}} />);
 expect(document.querySelector('img')).toHaveAttribute('src','https://example.com/poster.jpg');
 expect(screen.getByLabelText('Common Sense age 7+')).toBeInTheDocument();
 expect(screen.getByText('94%')).toBeInTheDocument();
 expect(screen.getByText('8.2')).toBeInTheDocument();
 expect(screen.getByText('Studio')).toBeInTheDocument();
 expect(screen.getByLabelText(/Jun 20, 2025/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button'));
 expect(onSelect).toHaveBeenCalledOnce();
});
it('keeps missing ratings explicit without fabricated scores or availability',()=>{
 render(<CatalogMovieCard onSelect={()=>{}} movie={{...emptyMovie(false),title:'New release',year:2026,imdb:null,rottenTomatoes:null,commonSenseAge:null}} />);
 expect(screen.getByText('Ratings pending')).toBeInTheDocument();
 expect(screen.getByText('Age guidance unknown')).toBeInTheDocument();
 expect(screen.getAllByText('Pending')).toHaveLength(2);
 expect(screen.queryByText(/streaming|rent|purchase/i)).toBeNull();
});

// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import StreamingSection from './StreamingSection';
import type { StreamingInfo, StreamingProvider } from '../types';

afterEach(cleanup);
const offer = (extra: Partial<StreamingProvider>): StreamingProvider => ({ id: 1, name: 'Movie Store', logo: null, link: 'https://example.com/movie', ...extra });
it('shows individual quality offers and labels access', () => {
 const data: StreamingInfo = { region: 'US', link: null, fetchedAt: '2026-09-04T12:00:00Z', stream: [offer({ accessType: 'sub', name: 'Subscription' }), offer({ accessType: 'free', name: 'Free service' })], rent: [offer({ price: 3.99, currency: 'USD', format: 'HD' }), offer({ price: 5.99, currency: 'USD', format: '4K' }), offer({ price: null, format: 'SD' })], buy: [offer({ price: 0, currency: 'USD', format: 'HD' })] };
 render(<StreamingSection streaming={data} />);
 expect(screen.queryByText(/Lowest reported rental/)).toBeNull();
 expect(screen.getByRole('link',{name:'Movie Store rent HD: $3.99'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'Movie Store rent 4K: $5.99'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'Movie Store buy HD: $0.00'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'Movie Store rent SD: Check price'})).toBeTruthy();
 expect(screen.getByText('With subscription')).toBeTruthy();
 expect(screen.getByText('Free · ads may apply')).toBeTruthy();
 expect(screen.getByText(/Checked 9\/4\/2026/)).toBeTruthy();
 expect(screen.getAllByRole('link').every(a => a.getAttribute('href') === 'https://example.com/movie')).toBe(true);
});
it('renders old caches without inventing prices', () => {
 render(<StreamingSection streaming={{ region:'US', link:null, fetchedAt:'invalid', stream:[], rent:[offer({})], buy:[] }} />);
 expect(screen.getByText('Check price')).toBeTruthy();
 expect(screen.queryByText(/Lowest reported/)).toBeNull();
 expect(screen.getByText(/Last check unknown/)).toBeTruthy();
});

it('shows separate format cards with their own prices and links',()=>{
 const formats=['SD','HD','4K'];
 render(<StreamingSection streaming={{region:'US',link:null,fetchedAt:'2026-09-04',stream:[],buy:[],rent:formats.map((format,index)=>offer({name:'Amazon',format,price:19.98,currency:'USD',logo:'https://example.com/logo.png',link:`https://example.com/${index}`}))}}/>);
 expect(screen.getAllByText('Amazon')).toHaveLength(3);
 const row = screen.getByRole('group', {name:'Amazon rent offers'});
 expect(row.querySelectorAll('a')).toHaveLength(3);
 expect(row.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
 formats.forEach((format,index)=>expect(screen.getByRole('link',{name:`Amazon rent ${format}: $19.98`}).getAttribute('href')).toBe(`https://example.com/${index}`));
});
it('keeps providers separate and falls back safely when deep link is absent',()=>{
 render(<StreamingSection searchTitle="A movie" streaming={{region:'US',link:'https://example.com/fallback',fetchedAt:'2026-09-04',stream:[],buy:[offer({id:1,name:'Store A',format:'HD',price:5,currency:'USD',link:null}),offer({id:2,name:'Store B',format:'4K',price:9,currency:'USD'})],rent:[]}}/>);
 expect(screen.getAllByRole('link')).toHaveLength(2);
 expect(screen.getByRole('link',{name:'Store A buy HD: $5.00'}).getAttribute('href')).toBe('https://example.com/fallback');
 expect(screen.getByRole('link',{name:'Store B buy 4K: $9.00'})).toBeTruthy();
});

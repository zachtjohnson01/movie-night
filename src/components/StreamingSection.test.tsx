// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import StreamingSection from './StreamingSection';
import type { StreamingInfo, StreamingProvider } from '../types';

afterEach(cleanup);
const offer = (extra: Partial<StreamingProvider>): StreamingProvider => ({ id: 1, name: 'Movie Store', logo: null, link: 'https://example.com/movie', ...extra });
it('shows prices and quality, compares rentals within quality, and labels access', () => {
 const data: StreamingInfo = { region: 'US', link: null, fetchedAt: '2026-09-04T12:00:00Z', stream: [offer({ accessType: 'sub', name: 'Subscription' }), offer({ accessType: 'free', name: 'Free service' })], rent: [offer({ price: 3.99, currency: 'USD', format: 'HD' }), offer({ price: 5.99, currency: 'USD', format: '4K' }), offer({ price: null, format: 'SD' })], buy: [offer({ price: 0, currency: 'USD', format: 'HD' })] };
 render(<StreamingSection streaming={data} />);
 expect(screen.getByText('Lowest reported rental: $3.99 (HD) · $5.99 (4K)')).toBeTruthy();
 expect(screen.getByText('$0.00 · HD')).toBeTruthy();
 expect(screen.getByText('Check price · SD')).toBeTruthy();
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

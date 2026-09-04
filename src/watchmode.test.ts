import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamingInfo } from './types';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('Watchmode priced offers', () => {
  it('preserves quality variants, maps buy and legacy purchase, and rejects other regions', async () => {
    vi.stubEnv('VITE_WATCHMODE_API_KEY', 'test');
    const source = { source_id: 1, name: 'Store', region: 'US', web_url: 'https://example.com/movie' };
    const rows = [
      { ...source, type: 'rent', price: 3.99, format: 'HD' },
      { ...source, type: 'rent', price: 3.99, format: 'HD' },
      { ...source, type: 'rent', price: 5.99, format: '4K' },
      { ...source, type: 'buy', price: 12.99, format: 'HD' },
      { ...source, type: 'purchase', price: null, format: '4K' },
      { ...source, type: 'rent', price: 0, format: 'SD' },
      { ...source, region: 'GB', type: 'rent', price: 1 },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/title/') ? rows : [] })));
    const { getStreamingByImdbId, isStreamingStale, offerPrice } = await import('./watchmode');
    const data = await getStreamingByImdbId('tt123');
    expect(data.rent).toHaveLength(3);
    expect(data.buy.map(p => p.accessType)).toEqual(['buy', 'buy']);
    expect(offerPrice(data.rent[2])).toBe('$0.00');
    expect(offerPrice(data.buy[1])).toBe('Check price');
    expect(isStreamingStale(data)).toBe(false);
    expect(isStreamingStale({ ...data, cacheVersion: undefined })).toBe(true);
    expect(isStreamingStale({ ...data, fetchedAt: 'invalid' })).toBe(true);
  });
  it('does not infer a currency or zero price from old caches', async () => {
    const { offerPrice, isStreamingStale } = await import('./watchmode');
    expect(offerPrice({ id: 1, name: 'Store', logo: null })).toBe('Check price');
    expect(offerPrice({ id: 1, name: 'Store', logo: null, price: 3 })).toBe('Check price');
    expect(isStreamingStale({ fetchedAt: new Date().toISOString(), source: 'watchmode' } as StreamingInfo)).toBe(true);
  });
});

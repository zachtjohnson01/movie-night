import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import handler, {
  normalizeTitle,
  rewritePosterSize,
  lookupPosterUrl,
} from './[slug]';

const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';

type FakeRes = VercelResponse & {
  _status: number;
  _body: unknown;
  _headers: Record<string, string>;
};

type MovieRow = { family_id: string | null; kind: string; movies: unknown[] };

function stubSupabase(rows: MovieRow[]) {
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  } as never);
}

const johnsonsLib = (movies: unknown[]): MovieRow => ({
  family_id: JOHNSON_FAMILY_UUID,
  kind: 'library',
  movies,
});

const globalPool = (movies: unknown[]): MovieRow => ({
  family_id: null,
  kind: 'pool',
  movies,
});

function makeReq(query: Record<string, string>): VercelRequest {
  return {
    query,
    headers: { host: 'x.test', 'x-forwarded-proto': 'https' },
  } as unknown as VercelRequest;
}

function makeRes(): FakeRes {
  const res: Partial<FakeRes> = {
    _status: 0,
    _body: undefined,
    _headers: {},
  };
  res.setHeader = vi.fn((name: string, value: string | number | string[]) => {
    res._headers![name.toLowerCase()] = String(value);
    return res as FakeRes;
  }) as FakeRes['setHeader'];
  res.status = vi.fn((s: number) => {
    res._status = s;
    return res as FakeRes;
  }) as FakeRes['status'];
  res.send = vi.fn((b: unknown) => {
    res._body = b;
    return res as FakeRes;
  }) as FakeRes['send'];
  res.json = vi.fn((b: unknown) => {
    res._body = b;
    return res as FakeRes;
  }) as FakeRes['json'];
  return res as FakeRes;
}

describe('rewritePosterSize', () => {
  it('upscales _SX300 to _SX600', () => {
    expect(
      rewritePosterSize(
        'https://m.media-amazon.com/images/M/abc._SX300.jpg',
      ),
    ).toBe('https://m.media-amazon.com/images/M/abc._SX600.jpg');
  });

  it('upscales any _SX<digits> to _SX600', () => {
    expect(rewritePosterSize('foo._SX150.jpg')).toBe('foo._SX600.jpg');
    expect(rewritePosterSize('foo._SX1.jpg')).toBe('foo._SX600.jpg');
  });

  it('rewrites already-_SX600 URLs to _SX600 (no-op)', () => {
    expect(rewritePosterSize('foo._SX600.jpg')).toBe('foo._SX600.jpg');
  });

  it('passes through URLs with no _SX segment unchanged', () => {
    expect(rewritePosterSize('https://example.com/poster.jpg')).toBe(
      'https://example.com/poster.jpg',
    );
  });
});

describe('normalizeTitle (poster)', () => {
  it('matches share-core normalizer behavior', () => {
    expect(normalizeTitle('  The   Lego   Movie  ')).toBe('the lego movie');
  });
});

describe('lookupPosterUrl', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it('joins by imdbId when entry has one', async () => {
    stubSupabase([
      johnsonsLib([{ title: 'Bolt', imdbId: 'tt1' }]),
      globalPool([
        { title: 'Bolt', imdbId: 'tt1', poster: 'http://p/abc._SX300.jpg' },
      ]),
    ]);
    const r = await lookupPosterUrl('Bolt');
    expect(r.poster).toBe('http://p/abc._SX300.jpg');
    expect(r.entryMatch).toBe('exact');
  });

  it('falls back to candidate-only match when no entry exists', async () => {
    stubSupabase([
      johnsonsLib([]),
      globalPool([
        { title: 'Bolt', imdbId: 'tt1', poster: 'http://p/abc._SX300.jpg' },
      ]),
    ]);
    const r = await lookupPosterUrl('Bolt');
    expect(r.poster).toBe('http://p/abc._SX300.jpg');
    expect(r.entryMatch).toBe('none');
  });

  it('returns {poster: null} when nothing matches', async () => {
    stubSupabase([johnsonsLib([]), globalPool([])]);
    const r = await lookupPosterUrl('Missing');
    expect(r.poster).toBeNull();
  });

  it('ignores library rows from other families', async () => {
    const otherId = '00000002-0000-0000-0000-000000000002';
    stubSupabase([
      {
        family_id: otherId,
        kind: 'library',
        movies: [{ title: 'Bolt', imdbId: 'tt1' }],
      },
      globalPool([
        { title: 'Bolt', imdbId: 'tt1', poster: 'http://p/abc._SX300.jpg' },
      ]),
    ]);
    const r = await lookupPosterUrl('Bolt');
    // Other family's library should not contribute the entry; we
    // still resolve the poster via the global pool fallback.
    expect(r.poster).toBe('http://p/abc._SX300.jpg');
    expect(r.entryMatch).toBe('none');
  });
});

describe('poster handler', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    stubSupabase([
      johnsonsLib([{ title: 'Bolt', imdbId: 'tt1' }]),
      globalPool([
        { title: 'Bolt', imdbId: 'tt1', poster: 'http://p/abc._SX300.jpg' },
      ]),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips .jpg extension from slug and returns image bytes with long cache', async () => {
    const fakeBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      // Verify the upstream URL was upscaled to _SX600
      expect(url).toContain('_SX600');
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => fakeBytes.buffer.slice(
          fakeBytes.byteOffset,
          fakeBytes.byteOffset + fakeBytes.byteLength,
        ),
      };
    }) as typeof fetch;

    const req = makeReq({ slug: 'Bolt.jpg' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toBe('image/jpeg');
    expect(res._headers['cache-control']).toBe(
      'public, max-age=604800, s-maxage=604800',
    );
    expect(res._headers['x-commit']).toBeDefined();
  });

  it('returns 404 when no poster matches', async () => {
    stubSupabase([johnsonsLib([]), globalPool([])]);
    const req = makeReq({ slug: 'Missing.jpg' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(String(res._body)).toContain('poster not found');
  });

  it('returns 400 when slug is missing', async () => {
    const req = makeReq({ slug: '.jpg' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(String(res._body)).toBe('missing title');
  });

  it('returns JSON for ?debug=1 with lookup state', async () => {
    const req = makeReq({ slug: 'Bolt.jpg', debug: '1' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('application/json');
    const body = res._body as Record<string, unknown>;
    expect(body.title).toBe('Bolt');
    expect(body.poster).toBe('http://p/abc._SX300.jpg');
    expect(body.entryMatch).toBe('exact');
  });

  it('returns 500 with commit SHA when handler crashes', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('upstream down')) as typeof fetch;
    const req = makeReq({ slug: 'Bolt.jpg' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(String(res._body)).toContain('poster handler crashed');
    expect(String(res._body)).toContain('upstream down');
  });

  it('returns the upstream status code if Amazon returns non-2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
    }) as typeof fetch;
    const req = makeReq({ slug: 'Bolt.jpg' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
    expect(String(res._body)).toContain('upstream 403');
  });
});

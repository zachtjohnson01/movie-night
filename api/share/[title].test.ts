import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import handler from './[title]';

const TEMPLATE = `<!doctype html>
<html><head>
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:title" content="Family Movie Night" />
<meta property="og:image" content="https://x/og-image.svg" />
</head><body></body></html>`;

const BOLT_ENTRY = {
  title: 'Bolt',
  imdbId: 'tt0397892',
  displayTitle: null,
  commonSenseAge: '5+',
};
const BOLT_CANDIDATE = {
  title: 'Bolt',
  imdbId: 'tt0397892',
  year: 2008,
  poster: 'https://m.media-amazon.com/images/M/abc._SX300.jpg',
  rottenTomatoes: '90%',
  imdb: '6.8',
};

type FakeRes = VercelResponse & {
  _status: number;
  _body: unknown;
  _headers: Record<string, string>;
};

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

function stubSupabase(rows: { id: number; movies: unknown[] }[]) {
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  } as never);
}

function stubTemplateFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => TEMPLATE,
  }) as typeof fetch;
}

describe('share handler', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    stubSupabase([
      { id: 1, movies: [BOLT_ENTRY] },
      { id: 2, movies: [BOLT_CANDIDATE] },
    ]);
    stubTemplateFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 HTML with og:image pointing at the poster proxy on a normal request', async () => {
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('text/html');
    expect(res._headers['x-share-resolved']).toBe('1');
    expect(res._headers['x-commit']).toMatch(/^[a-f0-9]{1,7}$/);
    expect(String(res._body)).toMatch(
      /og:image" content="https:\/\/x\.test\/api\/poster\/Bolt\.jpg/,
    );
  });

  it('strips the static og:image and apple-touch-icon from the template', async () => {
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    const body = String(res._body);
    expect(body).not.toContain('https://x/og-image.svg');
    expect(body).not.toContain('apple-touch-icon');
  });

  it('returns JSON for ?debug=1 with resolved movie and counts', async () => {
    const req = makeReq({ title: 'Bolt', debug: '1' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('application/json');
    expect(res._headers['cache-control']).toBe('no-store');
    const body = res._body as Record<string, unknown>;
    expect(body.requestedTitle).toBe('Bolt');
    expect(body.entryMatch).toBe('exact');
    expect(body.candidateMatch).toBe('imdbId');
    expect((body.resolved as { title: string }).title).toBe('Bolt');
    expect((body.resolved as { poster: string }).poster).toBe(
      BOLT_CANDIDATE.poster,
    );
  });

  it('returns text/plain HTML for ?debug=html so iOS Safari can view-source', async () => {
    const req = makeReq({ title: 'Bolt', debug: 'html' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('text/plain');
    expect(String(res._body)).toContain('<meta property="og:image"');
  });

  it('decodes percent-encoded titles before looking them up', async () => {
    stubSupabase([
      { id: 1, movies: [{ ...BOLT_ENTRY, title: 'Bolt: The Movie' }] },
      { id: 2, movies: [{ ...BOLT_CANDIDATE, title: 'Bolt: The Movie' }] },
    ]);
    const req = makeReq({ title: 'Bolt%3A%20The%20Movie' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['x-share-resolved']).toBe('1');
  });

  it('sets x-share-resolved=0 and falls back to og-image.svg when no movie is found', async () => {
    stubSupabase([
      { id: 1, movies: [] },
      { id: 2, movies: [] },
    ]);
    const req = makeReq({ title: 'Missing' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['x-share-resolved']).toBe('0');
    expect(String(res._body)).toContain('og-image.svg');
  });

  it('returns 502 if the index.html template fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'broken',
    }) as typeof fetch;
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(502);
    expect(String(res._body)).toContain('failed to fetch index.html');
  });

  it('returns 500 with the commit SHA in body when the handler crashes', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as typeof fetch;
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._headers['x-commit']).toBeDefined();
    expect(String(res._body)).toContain('boom');
    expect(String(res._body)).toContain('share handler crashed');
    expect(res._headers['cache-control']).toBe('no-store');
  });

  it('emits exactly one og:image tag (no static-tag duplicates)', async () => {
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    const matches = String(res._body).match(/<meta property="og:image"/g);
    expect(matches?.length).toBe(1);
  });

  it('declares 600x888 og:image dimensions when poster is set', async () => {
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    const body = String(res._body);
    expect(body).toContain('og:image:width" content="600"');
    expect(body).toContain('og:image:height" content="888"');
  });

  it('emits og:title with the movie title and year', async () => {
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    expect(String(res._body)).toContain('og:title" content="Bolt (2008)"');
  });

  it('includes a meta-refresh tag pointing at the SPA deep-link URL', async () => {
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    expect(String(res._body)).toContain(
      '<meta http-equiv="refresh" content="0; url=/?m=Bolt"',
    );
  });
});

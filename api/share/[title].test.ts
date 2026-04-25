import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

vi.mock('../_lib/share-core', async () => {
  const actual =
    await vi.importActual<typeof import('../_lib/share-core')>(
      '../_lib/share-core',
    );
  return {
    ...actual,
    lookupMovie: vi.fn(),
  };
});

import { lookupMovie } from '../_lib/share-core';
import handler from './[title]';

const TEMPLATE = `<!doctype html>
<html><head>
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:title" content="Family Movie Night" />
<meta property="og:image" content="https://x/og-image.svg" />
</head><body></body></html>`;

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

const BOLT_RESULT = {
  movie: {
    title: 'Bolt',
    displayTitle: null,
    year: 2008,
    rottenTomatoes: '90%',
    imdb: '6.8',
    commonSenseAge: '5+',
    poster: 'https://m.media-amazon.com/images/M/abc._SX300.jpg',
  },
  debug: {
    entryCount: 1,
    candidateCount: 1,
    entryMatch: 'exact' as const,
    candidateMatch: 'imdbId' as const,
  },
};

describe('share handler', () => {
  beforeEach(() => {
    vi.mocked(lookupMovie).mockReset();
    vi.mocked(lookupMovie).mockResolvedValue(BOLT_RESULT);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => TEMPLATE,
    }) as typeof fetch;
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
    expect((body.resolved as { title: string }).title).toBe('Bolt');
  });

  it('returns text/plain HTML for ?debug=html so iOS Safari can view-source', async () => {
    const req = makeReq({ title: 'Bolt', debug: 'html' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('text/plain');
    expect(String(res._body)).toContain('<meta property="og:image"');
  });

  it('decodes percent-encoded titles', async () => {
    const req = makeReq({ title: 'Bolt%3A%20The%20Movie' });
    const res = makeRes();
    await handler(req, res);
    expect(vi.mocked(lookupMovie)).toHaveBeenCalledWith('Bolt: The Movie');
  });

  it('sets x-share-resolved=0 when no movie is found', async () => {
    vi.mocked(lookupMovie).mockResolvedValue({
      movie: null,
      debug: {
        entryCount: 0,
        candidateCount: 0,
        entryMatch: 'none',
        candidateMatch: 'none',
      },
    });
    const req = makeReq({ title: 'Missing' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['x-share-resolved']).toBe('0');
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
    vi.mocked(lookupMovie).mockRejectedValue(new Error('boom'));
    const req = makeReq({ title: 'Bolt' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._headers['x-commit']).toBeDefined();
    expect(String(res._body)).toContain('boom');
    expect(String(res._body)).toContain('share handler crashed');
    expect(res._headers['cache-control']).toBe('no-store');
  });
});

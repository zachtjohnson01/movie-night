import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Env is read at module load, so seed it before the handler module evaluates.
// ANTHROPIC_API_KEY is intentionally left unset: a request that clears auth
// then stops at the "not configured" 503 proves authorization *passed*.
vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.ANTHROPIC_API_KEY;
});

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import handler, { buildPrompt } from './recommendations';

const OWNER_ID = '0df1ce41-9ab4-445c-aeee-4d6ee2d279ef';

type FakeRes = VercelResponse & { _status: number; _body: unknown };

function makeRes(): FakeRes {
  const res: Partial<FakeRes> = { _status: 0, _body: undefined };
  res.setHeader = vi.fn(() => res as FakeRes) as FakeRes['setHeader'];
  res.status = vi.fn((s: number) => {
    res._status = s;
    return res as FakeRes;
  }) as FakeRes['status'];
  res.json = vi.fn((b: unknown) => {
    res._body = b;
    return res as FakeRes;
  }) as FakeRes['json'];
  res.end = vi.fn(() => res as FakeRes) as FakeRes['end'];
  return res as FakeRes;
}

function makeReq(headers: Record<string, string>): VercelRequest {
  return {
    method: 'POST',
    headers,
    body: { poolTitles: [], libraryTitles: [] },
  } as unknown as VercelRequest;
}

// A stub Supabase client: getUser resolves to `user`, and the family_members
// query resolves to `members`. Mirrors the exact chain authenticate() walks.
function stubClient(opts: {
  user: { id: string; email: string } | null;
  userErr?: unknown;
  members?: Array<{ is_global_owner: boolean }>;
  memErr?: unknown;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.userErr ?? null,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: opts.members ?? null,
          error: opts.memErr ?? null,
        }),
      }),
    }),
  };
}

describe('recommendations auth', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it('rejects a request with no Authorization header (401)', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(res._status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  // The regression guard: the caller's JWT must be threaded into the Supabase
  // client so the RLS-scoped family_members read runs as the authenticated
  // user. Without this header the roster read runs as `anon`, which cannot
  // execute is_family_member — the owner check then false-negatives.
  it('creates the Supabase client with the caller token in the auth header', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubClient({ user: null, userErr: { message: 'bad' } }) as never,
    );
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer tok-123' }), res);

    expect(createClient).toHaveBeenCalledWith(
      'https://x.supabase.co',
      'anon-key',
      { global: { headers: { Authorization: 'Bearer tok-123' } } },
    );
  });

  it('authorizes a global owner (passes auth, stops at the config gate)', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubClient({
        user: { id: OWNER_ID, email: 'zach@example.com' },
        members: [{ is_global_owner: true }],
      }) as never,
    );
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer tok-123' }), res);

    // ANTHROPIC_API_KEY is unset, so a fully-authorized request lands on the
    // 503 config gate — which only executes *after* auth succeeds.
    expect(res._status).toBe(503);
  });

  it('rejects a signed-in non-owner (403)', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubClient({
        user: { id: 'someone-else', email: 'member@example.com' },
        members: [{ is_global_owner: false }],
      }) as never,
    );
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer tok-123' }), res);
    expect(res._status).toBe(403);
  });
});

describe('buildPrompt', () => {
  const anchor = (over: Partial<Parameters<typeof buildPrompt>[3]['anchors'][number]> = {}) => ({
    title: 'Spirited Away',
    year: 2001,
    studio: 'Studio Ghibli',
    directors: ['Hayao Miyazaki'],
    commonSenseAge: '8+',
    rottenTomatoes: '97%',
    imdb: '8.6',
    favorite: false,
    ...over,
  });

  const taste = (over: Partial<Parameters<typeof buildPrompt>[3]> = {}) => ({
    anchors: [anchor()],
    directors: ['Hayao Miyazaki', 'Brad Bird'],
    writers: ['Brad Bird'],
    studios: ['Studio Ghibli'],
    watchedCount: 42,
    ...over,
  });

  it('leads with the seed films and their metadata', () => {
    const p = buildPrompt([], [], 20, taste());
    expect(p).toContain('SEED FILMS');
    expect(p).toContain('Spirited Away (2001)');
    expect(p).toContain('Studio Ghibli');
    expect(p).toContain('dir. Hayao Miyazaki');
    expect(p).toContain('CSM 8+');
    expect(p).toContain('RT 97%, IMDb 8.6');
    expect(p).toContain('derived from 42 watched films');
    // The taste profile must come before the ban list, not after it.
    expect(p.indexOf('SEED FILMS')).toBeLessThan(p.indexOf('BAN LIST'));
  });

  it('marks explicit favorites so they read as the strongest signal', () => {
    expect(buildPrompt([], [], 20, taste({ anchors: [anchor({ favorite: true })] })))
      .toContain('[FAVORITE]');
  });

  it('omits metadata the library does not have', () => {
    const bare = buildPrompt([], [], 20, taste({
      anchors: [anchor({ year: null, studio: null, directors: [], commonSenseAge: null, rottenTomatoes: null, imdb: null })],
    }));
    const line = bare.split('\n').find((l) => l.startsWith('1. '))!;
    expect(line).toBe('1. Spirited Away');
    expect(bare).not.toContain('undefined');
    expect(bare).not.toContain('null');
  });

  it('requires a similarTo justification in the output shape', () => {
    const p = buildPrompt([], [], 20, taste());
    expect(p).toContain('"similarTo"');
    expect(p).toContain('SEED FILM above that this recommendation most resembles');
  });

  it('steers web search toward neighbour queries and away from generic lists', () => {
    const p = buildPrompt([], [], 20, taste());
    expect(p).toContain('movies like <seed film>');
    expect(p).toContain('best kids movies 2024');
    expect(p).toContain('do NOT spend a search on these');
  });

  it('still emits the ban list and the requested target', () => {
    const p = buildPrompt(['Pool One'], ['Owned One'], 37, taste());
    expect(p).toContain('Pool One');
    expect(p).toContain('Owned One');
    expect(p).toContain('return up to 37 feature films');
  });

  it('degrades gracefully when the family has no profile yet', () => {
    const p = buildPrompt([], [], 20, {
      anchors: [], directors: [], writers: [], studios: [], watchedCount: 0,
    });
    expect(p).not.toContain('SEED FILMS');
    expect(p).toContain('BAN LIST');
    expect(p).toContain('(none)');
    expect(p).toContain('return up to 20 feature films');
  });
});

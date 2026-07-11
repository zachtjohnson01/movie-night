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
import handler from './recommendations';

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

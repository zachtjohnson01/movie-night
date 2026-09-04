import { describe, it, expect, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
const { prompts, owner } = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-only';
  return { prompts: [] as string[], owner: { allowed: true } };
});
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: (args: { messages: { content: string }[] }) => {
  prompts.push(args.messages[0].content);
  return { on: vi.fn(), finalMessage: async () => ({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: {} }) };
} }; } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, from: () => ({ select: () => ({ eq: async () => ({ data: [{ is_global_owner: owner.allowed }] }) }) }) }) }));
import handler from '../../api/recommendations';
async function request(mode?: string) {
  let status = 200; let body: any;
  const response = { setHeader: vi.fn(), status: (s: number) => { status = s; return response; }, json: (b: unknown) => { body = b; return response; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { mode, batchSize: 10, poolTitles: ['Existing'] } } as VercelRequest, response as unknown as VercelResponse);
  return { status, body };
}
describe('authenticated comparison modes', () => {
  it('uses original prompt count for baseline and overrequests by default for enhanced', async () => {
    owner.allowed = true;
    const before = await request('baseline');
    expect(before.body.metrics).toMatchObject({ mode: 'baseline', candidateTarget: 10, completionObserved: false });
    expect(prompts.at(-1)).toContain('Return up to 10 feature-length');
    const after = await request();
    expect(after.body.metrics).toMatchObject({ mode: 'enhanced', candidateTarget: 16, completionObserved: true });
    expect(prompts.at(-1)).toContain('up to 16 distinct');
  });
  it('does not permit the comparison mode to bypass owner authorization', async () => {
    owner.allowed = false;
    const count = prompts.length;
    expect((await request('baseline')).status).toBe(403);
    expect(prompts).toHaveLength(count);
    owner.allowed = true;
  });
});

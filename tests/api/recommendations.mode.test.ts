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
  it('accepts only authenticated sanitized reports without AI or logging user payloads', async () => {
    owner.allowed = true;
    const count = prompts.length;
    const log = vi.spyOn(console,'info').mockImplementation(() => {});
    const payload = {action:'report',runId:'12345678-1234-4123-8123-123456789abc',mode:'enhanced',status:'partial',counts:{raw:5,checked:4,unmatched:1,errors:1,duplicates:1,verified:2,lookupNetwork:1,lookupNotConfigured:0,lookupNotFound:0,lookupUnknown:0}};
    let result: unknown; let code = 200;
    const res = {setHeader:vi.fn(),status:(n:number)=>{code=n;return res;},json:(v:unknown)=>{result=v;return res;}};
    const send = (body: unknown) => handler({method:'POST',headers:{authorization:'Bearer private-token'},body} as VercelRequest,res as unknown as VercelResponse);
    await send(payload);
    expect(code).toBe(200); expect(result).toEqual({received:true}); expect(prompts).toHaveLength(count);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
    const logged = log.mock.calls.length;
    await send({...payload,titles:['private title']});
    expect(code).toBe(400); expect(log.mock.calls).toHaveLength(logged);
    await send({...payload,runId:'bad'}); expect(code).toBe(400);
    await send({...payload,counts:{...payload.counts,raw:-1}}); expect(code).toBe(400);
    owner.allowed = false; await send(payload);
    expect(code).toBe(403); expect(log.mock.calls).toHaveLength(logged);
    owner.allowed = true; log.mockRestore();
  });

});

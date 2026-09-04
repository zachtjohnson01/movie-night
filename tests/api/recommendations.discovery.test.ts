import { describe, expect, it, vi, beforeEach } from 'vitest';
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', async (original) => { const actual = await original<typeof import('@anthropic-ai/sdk')>(); return { default: class { static APIError = actual.default.APIError; static APIConnectionError = actual.default.APIConnectionError; messages = { stream }; } }; });
import { buildPrompt, parseCandidates, generateCandidates, buildBaselinePrompt, parseBaselineCandidates, retainObservedEvidence, generationErrorReason } from '../../api/recommendations';

describe('catalog discovery', () => {
  beforeEach(() => { stream.mockReset(); });
  it('uses the supplied current date, wider catalog scope, and exact candidate target', () => {
    const prompt = buildPrompt(['Existing'], [], 64, [], [], [], 'recent', new Date('2026-09-04'));
    expect(prompt).toContain('Today is 2026-09-04');
    expect(prompt).toContain('through age 12');
    expect(prompt).toContain('up to 64 distinct');
    expect(prompt).toContain('2025 and 2026');
    expect(prompt).toContain('"Existing"');
  });
  it('retains identity hints but rejects unsourced ages and unsafe URLs', () => {
    const [film] = parseCandidates(JSON.stringify([{ title: 'Test', year: 2026, imdbId: 'tt1234567', commonSenseAge: '6+', evidenceUrl: 'javascript:alert(1)' }]));
    expect(film.imdbId).toBe('tt1234567');
    expect(film.commonSenseAge).toBeNull();
    expect(film.evidenceUrl).toBeNull();
  });
  it('accepts review-linked ages and recovers complete candidates from truncated output', () => {
    const movies = parseCandidates('[{"title":"Test","year":2026,"commonSenseAge":"8+","commonSenseSourceUrl":"https://www.commonsensemedia.org/movie-reviews/test"},{"title":');
    expect(movies).toHaveLength(1);
    expect(movies[0].commonSenseAge).toBe('8+');
  });
  it('exposes observed search usage and source pages, not invented candidate counts', async () => {
    stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{ type: 'text', text: '[]' }, { type: 'web_search_tool_result', content: [{ url: 'https://example.com/film' }] }], stop_reason: 'end_turn', usage: { server_tool_use: { web_search_requests: 2 } } }) });
    const result = await generateCandidates('test', 'prompt');
    expect(result).toEqual({ text: '[]', status: 'complete', reason: 'complete', stopReason: 'end_turn', webSearchRequests: 2, sourceUrls: ['https://example.com/film'] });
  });
  it('reports transport errors separately from a successful empty result', async () => {
    stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => { throw new Error('network'); } });
    expect((await generateCandidates('test', 'prompt')).status).toBe('error');
  });
  it('identifies output limits and malformed responses', async () => {
    stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{type:'text',text:'[{"title":"One"},'}], stop_reason:'max_tokens',usage:{} }) });
    expect(await generateCandidates('test','prompt')).toMatchObject({status:'incomplete',reason:'model_output_limit',stopReason:'max_tokens'});
    stream.mockReturnValue({ on: vi.fn(), finalMessage: async () => ({ content: [{type:'text',text:'not json'}], stop_reason:'end_turn',usage:{} }) });
    expect(await generateCandidates('test','prompt')).toMatchObject({status:'incomplete',reason:'invalid_output'});
  });
  it('reports deadline distinctly from a network failure', async () => {
    vi.useFakeTimers();
    stream.mockImplementation((_args, options) => ({ on: vi.fn(), finalMessage: () => new Promise((_resolve,reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))) }));
    const promise = generateCandidates('test','prompt');
    await vi.advanceTimersByTimeAsync(30000);
    expect(await promise).toMatchObject({status:'time_limit',reason:'deadline'});
    vi.useRealTimers();
  });
  it('does not give a paused continuation a second paid search budget', async () => {
    const toolLengths: number[] = [];
    stream.mockImplementation((args) => {
      toolLengths.push(args.tools.length);
      return { on: vi.fn(), finalMessage: async () => ({ content: [{ type: 'text', text: '[]' }], stop_reason: toolLengths.length === 1 ? 'pause_turn' : 'end_turn', usage: {} }) };
    });
    const result = await generateCandidates('test', 'prompt');
    expect(toolLengths).toEqual([1, 0]);
    expect(result.status).toBe('complete');
  });
});


describe('frozen baseline comparison', () => {
  it('retains the original narrow age scope and request size for an honest comparison', () => {
    const baseline = buildBaselinePrompt(['Already present'], [], 40);
    expect(baseline).toContain('target CSM age 5–8');
    expect(baseline).toContain('Return up to 40 feature-length');
    expect(baseline).toContain('Already present');
    expect(buildPrompt(['Already present'], [], 64)).toContain('up to 64 distinct');
  });
  it('preserves legacy unsourced ages while enhanced parsing requires provenance', () => {
    const raw = '[{"title":"Example","year":2024,"commonSenseAge":"7+"}]';
    expect(parseBaselineCandidates(raw)[0].commonSenseAge).toBe('7+');
    expect(parseCandidates(raw)[0].commonSenseAge).toBeNull();
  });
});


describe('retrieval provenance', () => {
  it('drops model-provided evidence and ages when no retrieved URL corroborates provenance', () => {
    const [candidate] = parseCandidates('[{"title":"Example","evidenceUrl":"https://example.com/film","commonSenseAge":"8+","commonSenseSourceUrl":"https://www.commonsensemedia.org/movie-reviews/example"}]');
    const unobserved = retainObservedEvidence(candidate, []);
    expect(unobserved.evidenceUrl).toBeNull();
    expect(unobserved.commonSenseAge).toBeNull();
    const observed = retainObservedEvidence(candidate, ['https://www.commonsensemedia.org/movie-reviews/example']);
    expect(observed.commonSenseAge).toBe('8+');
    expect(observed.evidenceUrl).toBeNull();
  });
});


describe('sanitized provider failures', () => {
  it('distinguishes rate limits, credentials, provider failures and connections', async () => {
    const {default: SDK} = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
    expect(generationErrorReason(new SDK.APIError(429, undefined, 'private message', undefined),false)).toBe('rate_limit');
    expect(generationErrorReason(new SDK.APIError(401, undefined, 'private message', undefined),false)).toBe('service_auth');
    expect(generationErrorReason(new SDK.APIError(500, undefined, 'private message', undefined),false)).toBe('provider_error');
    expect(generationErrorReason(new SDK.APIConnectionError({message:'private host'}),false)).toBe('network');
    expect(generationErrorReason(new Error('private unknown'),false)).toBe('service_error');
  });
});

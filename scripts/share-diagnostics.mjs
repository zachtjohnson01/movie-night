#!/usr/bin/env node
/**
 * Share preview diagnostics.
 *
 * Hits a sequence of endpoints on the deployed app and asserts on
 * their shape. Each assertion corresponds to a regression we hit
 * during the multi-PR session that fixed iMessage unfurls. Run via
 * GitHub Actions on every PR (against the Vercel preview deploy)
 * and on push to main (against production).
 *
 * Env:
 *   BASE_URL    - target origin (no trailing slash). Required.
 *   TEST_TITLE  - movie title to test (default: "Bolt"). Must be
 *                 present in the user's library — change in the
 *                 workflow if Bolt is ever removed.
 *
 * Exit code 0 = all checks passed, 1 = one or more failed.
 */

const BASE = process.env.BASE_URL?.replace(/\/$/, '');
if (!BASE) {
  console.error('BASE_URL env var required');
  process.exit(1);
}
const TITLE = process.env.TEST_TITLE ?? 'Bolt';
const TITLE_ENC = encodeURIComponent(TITLE);

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  [32m✓[0m ${label}`);
  passed++;
}
function fail(label, detail) {
  console.log(`  [31m✗[0m ${label}`);
  if (detail) console.log(`    [2m${detail}[0m`);
  failed++;
}
function assert(label, cond, detail) {
  cond ? pass(label) : fail(label, detail);
}

function isVercelAuthPage(text) {
  return /Authentication Required|vercel\.com\/sso-api/i.test(text);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} on ${url}: ${body.slice(0, 200)}`);
  }
  if (!ct.includes('json')) {
    const body = await res.text();
    if (isVercelAuthPage(body)) {
      throw new Error(
        `${url} returned the Vercel deployment-protection auth page. ` +
          `Disable preview protection in Vercel Settings → Deployment Protection, ` +
          `or use a Protection Bypass token. Got content-type=${ct}.`,
      );
    }
    throw new Error(
      `${url} returned non-JSON (content-type=${ct}): ${body.slice(0, 200)}`,
    );
  }
  return await res.json();
}
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} on ${url}: ${body.slice(0, 200)}`);
  }
  const body = await res.text();
  if (isVercelAuthPage(body)) {
    throw new Error(
      `${url} returned the Vercel deployment-protection auth page.`,
    );
  }
  return body;
}

async function section(label, fn) {
  console.log(`\n[1m${label}[0m`);
  try {
    await fn();
  } catch (e) {
    fail('threw', e instanceof Error ? e.message : String(e));
  }
}

console.log(`Diagnostics against [36m${BASE}[0m (test title: "${TITLE}")`);

await section('GET /api/version', async () => {
  const data = await fetchJson(`${BASE}/api/version`);
  assert('commitSha present', typeof data.commitSha === 'string' && data.commitSha.length > 0, JSON.stringify(data));
  assert(
    'commitShaShort is 7 chars',
    typeof data.commitShaShort === 'string' && data.commitShaShort.length === 7,
    `got ${data.commitShaShort}`,
  );
  assert('env is production or preview', ['production', 'preview'].includes(data.env), `got ${data.env}`);
});

await section(`GET /share/${TITLE}?debug=1`, async () => {
  const data = await fetchJson(`${BASE}/share/${TITLE_ENC}?debug=1`);
  assert('hasSupabaseUrl', data.hasSupabaseUrl === true);
  assert('hasSupabaseKey', data.hasSupabaseKey === true);
  assert(
    'entryCount > 0',
    typeof data.entryCount === 'number' && data.entryCount > 0,
    `got ${data.entryCount}`,
  );
  assert(
    'candidateCount > 0',
    typeof data.candidateCount === 'number' && data.candidateCount > 0,
    `got ${data.candidateCount}`,
  );
  assert('entryMatch === "exact"', data.entryMatch === 'exact', `got ${data.entryMatch}`);
  assert(
    `resolved.title === "${TITLE}"`,
    data.resolved?.title === TITLE,
    `got ${data.resolved?.title}`,
  );
  assert(
    'resolved.poster populated',
    typeof data.resolved?.poster === 'string' && data.resolved.poster.length > 0,
    `got ${data.resolved?.poster}`,
  );
  assert(
    'resolved.year is a number',
    typeof data.resolved?.year === 'number',
    `got ${data.resolved?.year}`,
  );
});

await section(`GET /share/${TITLE}?debug=html`, async () => {
  const html = await fetchText(`${BASE}/share/${TITLE_ENC}?debug=html`);

  const ogImageMatches = [
    ...html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi),
  ];
  assert(
    'exactly one og:image tag',
    ogImageMatches.length === 1,
    `found ${ogImageMatches.length}`,
  );
  const ogImageUrl = ogImageMatches[0]?.[1] ?? '';
  assert('og:image points at /api/poster proxy', ogImageUrl.includes('/api/poster/'), ogImageUrl);
  assert('og:image has cache-buster ?v=', /\?v=[a-f0-9]+/.test(ogImageUrl), ogImageUrl);
  assert(
    'og:image path ends with .jpg before query',
    /\.jpg(\?|$)/.test(ogImageUrl),
    ogImageUrl,
  );
  assert(
    'og:image content does not contain "@" (Amazon URL leakage)',
    !ogImageUrl.includes('@'),
    ogImageUrl,
  );

  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const ogTitle = ogTitleMatch?.[1] ?? '';
  assert(`og:title contains "${TITLE}"`, ogTitle.includes(TITLE), ogTitle);
  assert('og:title is not the static fallback', !/^Family Movie Night$/.test(ogTitle), ogTitle);

  const ogWidthMatch = html.match(/<meta\s+property="og:image:width"\s+content="(\d+)"/i);
  const ogWidth = parseInt(ogWidthMatch?.[1] ?? '0', 10);
  assert(
    'og:image:width >= 600 (Apple LPMetadataProvider minimum)',
    ogWidth >= 600,
    `got ${ogWidth}`,
  );

  assert(
    'no apple-touch-icon link in response',
    !/<link\s+rel="apple-touch-icon"/i.test(html),
    'unfurler may fall back to it as a default',
  );

  const dupOgTitle = [...html.matchAll(/<meta\s+property="og:title"/gi)].length;
  assert('exactly one og:title tag', dupOgTitle === 1, `found ${dupOgTitle}`);
});

await section(`GET /api/poster/${TITLE}?debug=1`, async () => {
  const data = await fetchJson(`${BASE}/api/poster/${TITLE_ENC}?debug=1`);
  assert(
    'poster URL resolved',
    typeof data.poster === 'string' && data.poster.length > 0,
    `got ${data.poster}`,
  );
  assert('entryMatch === "exact"', data.entryMatch === 'exact', `got ${data.entryMatch}`);
});

await section(`GET /api/poster/${TITLE}.jpg`, async () => {
  const res = await fetch(`${BASE}/api/poster/${TITLE_ENC}.jpg`);
  assert('200 status', res.status === 200, `got ${res.status}`);

  const ct = res.headers.get('content-type') ?? '';
  assert('content-type starts with image/', ct.startsWith('image/'), `got ${ct}`);

  const buf = Buffer.from(await res.arrayBuffer());
  // Apple's LPMetadataProvider rejects images below ~600x315; a poster
  // at SX600 weighs in around 30-80KB. Anything tiny is probably an
  // error page that snuck past the status check.
  assert('response size > 10KB', buf.length > 10_000, `got ${buf.length} bytes`);
  assert(
    'valid JPEG magic bytes (FF D8 FF)',
    buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
    `got ${buf.subarray(0, 4).toString('hex')}`,
  );
});

console.log(
  `\n[1m=== ${passed} passed, ${failed} failed ===[0m`,
);
process.exit(failed === 0 ? 0 : 1);

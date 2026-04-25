import { describe, expect, it } from 'vitest';
import { buildShareHtml, escapeHtml, normalizeTitle } from './share-core';

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Family Movie Night" />
    <meta property="og:image" content="https://familymovienight.watch/og-image.svg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="https://familymovienight.watch/og-image.svg" />
    <title>Family Movie Night</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('normalizeTitle', () => {
  it('lowercases', () => {
    expect(normalizeTitle('BOLT')).toBe('bolt');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTitle('  Bolt  ')).toBe('bolt');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeTitle('The   Lego   Movie')).toBe('the lego movie');
  });

  it('NFC-normalizes decomposed characters', () => {
    const decomposed = 'Wall-E´'; // contains decomposed diacritic
    const composed = 'Wall-E´'.normalize('NFC');
    expect(normalizeTitle(decomposed)).toBe(composed.toLowerCase());
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle('')).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes all five entities in one pass', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('leaves safe characters alone', () => {
    expect(escapeHtml('Bolt (2008)')).toBe('Bolt (2008)');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('buildShareHtml', () => {
  const baseMovie = {
    title: 'Bolt',
    displayTitle: null,
    year: 2008,
    rottenTomatoes: '90%',
    imdb: '6.8',
    commonSenseAge: '5+',
    poster: 'https://m.media-amazon.com/images/M/abc._SX300.jpg',
  };

  it('strips static og:* tags from the template', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).not.toContain(
      '<meta property="og:title" content="Family Movie Night"',
    );
    expect(out).not.toContain(
      '<meta property="og:image" content="https://familymovienight.watch/og-image.svg"',
    );
  });

  it('strips the static apple-touch-icon link', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).not.toContain('apple-touch-icon');
  });

  it('strips the static twitter:* tags', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).not.toContain(
      '<meta name="twitter:image" content="https://familymovienight.watch/og-image.svg"',
    );
  });

  it('emits exactly one og:image tag', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    const ogImageMatches = out.match(/<meta property="og:image"/g);
    expect(ogImageMatches?.length).toBe(1);
  });

  it('points og:image at /api/poster/<title>.jpg with cache-buster when poster is set', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).toMatch(
      /<meta property="og:image" content="https:\/\/x\.test\/api\/poster\/Bolt\.jpg\?v=[a-f0-9]{1,7}"/,
    );
  });

  it('declares 600x888 dimensions and image/jpeg type when poster is set', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).toContain('<meta property="og:image:width" content="600"');
    expect(out).toContain('<meta property="og:image:height" content="888"');
    expect(out).toContain('<meta property="og:image:type" content="image/jpeg"');
  });

  it('falls back to /og-image.svg and omits dimensions when poster is missing', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: { ...baseMovie, poster: null },
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).toContain(
      '<meta property="og:image" content="https://x.test/og-image.svg"',
    );
    expect(out).not.toContain('<meta property="og:image:width"');
    expect(out).not.toContain('<meta property="og:image:height"');
  });

  it('falls back to /og-image.svg when movie is null entirely', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: null,
      canonical: 'https://x.test/share/missing',
    });
    expect(out).toContain(
      '<meta property="og:image" content="https://x.test/og-image.svg"',
    );
    expect(out).toContain(
      '<meta property="og:title" content="Family Movie Night"',
    );
  });

  it('builds og:title from displayTitle when set, falling back to title', () => {
    const withDisplay = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: { ...baseMovie, displayTitle: 'Bolt the Dog' },
      canonical: 'https://x.test/share/Bolt',
    });
    expect(withDisplay).toContain(
      '<meta property="og:title" content="Bolt the Dog (2008)"',
    );

    const withoutDisplay = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(withoutDisplay).toContain(
      '<meta property="og:title" content="Bolt (2008)"',
    );
  });

  it('joins description parts with em-dash separators', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).toContain(
      '<meta property="og:description" content="RT 90% — IMDb 6.8 — 5+"',
    );
  });

  it('HTML-escapes the title in og tags', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: { ...baseMovie, title: `Tom & Jerry "The Movie"` },
      canonical: 'https://x.test/share/Tom%20%26%20Jerry',
    });
    expect(out).toContain('Tom &amp; Jerry &quot;The Movie&quot; (2008)');
    expect(out).not.toContain('Tom & Jerry "The Movie"');
  });

  it('URL-encodes the title in the og:image path', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: { ...baseMovie, title: 'Bolt: The Movie' },
      canonical: 'https://x.test/share/Bolt%3A%20The%20Movie',
    });
    expect(out).toMatch(
      /\/api\/poster\/Bolt%3A%20The%20Movie\.jpg\?v=[a-f0-9]{1,7}/,
    );
  });

  it('emits the meta-refresh tag when spaRedirect is provided', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
      spaRedirect: '/?m=Bolt',
    });
    expect(out).toContain(
      '<meta http-equiv="refresh" content="0; url=/?m=Bolt"',
    );
  });

  it('omits the meta-refresh tag when spaRedirect is not provided', () => {
    const out = buildShareHtml({
      template: TEMPLATE,
      origin: 'https://x.test',
      movie: baseMovie,
      canonical: 'https://x.test/share/Bolt',
    });
    expect(out).not.toContain('http-equiv="refresh"');
  });
});

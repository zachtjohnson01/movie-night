/*
 * Visual tokens for the Modern Marquee design (Variant C). Kept separate
 * from Tailwind so the classic UI's `ink-*` / `amber-glow` palette is
 * untouched — the two designs render side-by-side and the user toggles
 * between them.
 */

export const BG = '#0a0a0f';
export const BG_2 = '#13131c';
export const BG_3 = '#1a1a26';
export const BORDER = '#2a2a3a';
export const INK = '#f5f3ef';
export const INK_2 = '#b6b3aa';
export const INK_3 = '#6b6879';
export const AMBER = '#f5a524';
export const CRIMSON = '#e85a4f';

export const DISPLAY = '"Fraunces", "Playfair Display", Georgia, serif';
export const SANS =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

/* Poster palettes lifted verbatim from the design's data.jsx. Four colors per
 * palette: [grad top, grad bottom, accent, ink]. A title hashes to one palette,
 * giving every unlinked movie a stable identity for the gradient hero on
 * Detail (and any other surface that wants a title-derived color). */
const POSTER_PALETTES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['#2a1810', '#6b2f1a', '#f4a261', '#fff7e6'],
  ['#0b1f3a', '#1d4e89', '#ffc857', '#e9f1fb'],
  ['#1a0b2e', '#5a189a', '#f72585', '#fce8f5'],
  ['#0f2a1d', '#2d6a4f', '#ffd166', '#e9f5ec'],
  ['#3a0b0b', '#9d0208', '#ffba08', '#ffe8cf'],
  ['#1b1b2f', '#162447', '#e94560', '#f5efff'],
  ['#2b1a0e', '#7a4e1d', '#f2bb77', '#fff1dd'],
  ['#0a0f1a', '#1f3a5f', '#79d0f2', '#e8f4ff'],
  ['#1a1a1a', '#3d3d3d', '#ffb347', '#f5f5f5'],
  ['#2e1a47', '#7b2cbf', '#c77dff', '#f3e8ff'],
  ['#06281f', '#1b4332', '#95d5b2', '#e7f7ef'],
  ['#3c1518', '#69140e', '#f3722c', '#fde8d7'],
];

export type PosterPalette = {
  c1: string;
  c2: string;
  accent: string;
  ink: string;
};

export function posterFor(title: string): PosterPalette {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) >>> 0;
  }
  const pal = POSTER_PALETTES[h % POSTER_PALETTES.length];
  return { c1: pal[0], c2: pal[1], accent: pal[2], ink: pal[3] };
}

/* Age badge tones as inline-style objects (fg/bg/border) — mirrors
 * `ageBadgeClass` in src/format.ts but returns raw hex so we can use it in
 * style props where Tailwind classes don't fit. */
export function ageTone(age: string | null): {
  fg: string;
  bg: string;
  border: string;
} {
  if (!age) {
    return {
      fg: '#cbd5c7',
      bg: 'rgba(120,120,120,0.12)',
      border: 'rgba(120,120,120,0.35)',
    };
  }
  const n = parseInt(age, 10);
  if (Number.isNaN(n)) {
    return {
      fg: '#cbd5c7',
      bg: 'rgba(120,120,120,0.12)',
      border: 'rgba(120,120,120,0.35)',
    };
  }
  if (n <= 4) {
    return {
      fg: '#86efac',
      bg: 'rgba(34,197,94,0.14)',
      border: 'rgba(34,197,94,0.45)',
    };
  }
  if (n <= 6) {
    return {
      fg: '#fcd34d',
      bg: 'rgba(245,158,11,0.14)',
      border: 'rgba(245,158,11,0.45)',
    };
  }
  if (n <= 8) {
    return {
      fg: '#fdba74',
      bg: 'rgba(249,115,22,0.14)',
      border: 'rgba(249,115,22,0.45)',
    };
  }
  return {
    fg: '#fda4af',
    bg: 'rgba(244,63,94,0.14)',
    border: 'rgba(244,63,94,0.45)',
  };
}

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/* Pure-date safe formatter for the Detail hero eyebrow (e.g. "October 11, 2024"). */
export function formatDateLong(iso: string | null): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${MONTHS_LONG[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

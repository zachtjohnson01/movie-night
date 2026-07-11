import type { Candidate } from './types';
import { dedupKey } from './omdb';

/**
 * Pure duplicate-detection + merge helpers for the pool. Kept separate from
 * the (DOM-heavy) PoolAdmin so the grouping / merge logic can be unit-tested
 * in a node env, the same way `useMovies.ts` exports its merge helpers.
 *
 * The pool is a flat `Candidate[]` keyed by `title` throughout the app, but
 * two rows can legitimately collide on title (remakes) or drift out of sync
 * (one linked to OMDB, one not). This module surfaces those collisions so an
 * admin can review them side by side and fold the extras into one survivor.
 */

export type DuplicateGroup = {
  /** Representative dedup key for the group (for stable React keys/sorting). */
  key: string;
  /** 2+ candidates that collide on title key and/or IMDb id. */
  members: Candidate[];
  /**
   * True when two members share the same non-null IMDb id — a strong signal
   * they're genuinely the same title. When false the group was formed on
   * title alone, which can be a false positive (e.g. a remake sharing a name
   * with the original), so the admin should look before merging.
   */
  sharesImdbId: boolean;
};

/**
 * Metadata fields folded from victims into the survivor when a value is
 * missing on the survivor. Intentionally excludes identity/user-intent fields
 * (`title`, `addedAt`, `downvoted`, `removedReason`, `removedAt`) which are
 * handled explicitly or preserved from the survivor.
 */
const FILL_FIELDS: (keyof Candidate)[] = [
  'year',
  'imdbId',
  'imdb',
  'rottenTomatoes',
  'rottenTomatoesId',
  'commonSenseAge',
  'studio',
  'awards',
  'poster',
  'directors',
  'writers',
  'streaming',
  'type',
  'displayTitle',
  'omdbRefreshedAt',
];

function isEmpty(v: unknown): boolean {
  return v == null || v === '';
}

/**
 * Group the live pool into sets of likely-duplicate candidates. Two rows land
 * in the same group when they share a `dedupKey(title)` OR a non-null
 * `imdbId`; the union of those two relations is computed with union-find so a
 * chain (A shares a title with B, B shares an id with C) collapses into one
 * group. Soft-removed rows (`removedAt != null`) are excluded — they're
 * deliberately parked on the expansion ban list and shouldn't be re-merged.
 */
export function findDuplicateGroups(candidates: Candidate[]): DuplicateGroup[] {
  const live = candidates.filter((c) => c.removedAt == null);

  const parent = live.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const firstByTitle = new Map<string, number>();
  const firstByImdb = new Map<string, number>();
  live.forEach((c, i) => {
    const tk = dedupKey(c.title);
    const seenTitle = firstByTitle.get(tk);
    if (seenTitle != null) union(seenTitle, i);
    else firstByTitle.set(tk, i);

    if (c.imdbId) {
      const seenImdb = firstByImdb.get(c.imdbId);
      if (seenImdb != null) union(seenImdb, i);
      else firstByImdb.set(c.imdbId, i);
    }
  });

  const byRoot = new Map<number, number[]>();
  live.forEach((_, i) => {
    const r = find(i);
    const arr = byRoot.get(r);
    if (arr) arr.push(i);
    else byRoot.set(r, [i]);
  });

  const groups: DuplicateGroup[] = [];
  byRoot.forEach((idxs) => {
    if (idxs.length < 2) return;
    const members = idxs.map((i) => live[i]);
    const ids = members
      .map((m) => m.imdbId)
      .filter((x): x is string => x != null);
    const sharesImdbId = new Set(ids).size < ids.length;
    groups.push({ key: dedupKey(members[0].title), members, sharesImdbId });
  });

  // Strong-signal groups (shared IMDb id) first, then alphabetical by key —
  // deterministic so the review stepper order is stable across renders.
  groups.sort((a, b) => {
    if (a.sharesImdbId !== b.sharesImdbId) return a.sharesImdbId ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
  return groups;
}

/**
 * How "complete" a candidate is — count of populated metadata fields, with a
 * heavy bonus for being linked to OMDB (`imdbId`). Used to pick a sensible
 * default survivor so the admin usually just confirms.
 */
export function completenessScore(c: Candidate): number {
  let score = 0;
  if (c.imdbId) score += 100;
  for (const f of FILL_FIELDS) {
    if (f === 'imdbId') continue;
    if (!isEmpty(c[f])) score += 1;
  }
  return score;
}

/**
 * Pick the index of the member that should survive a merge by default.
 * Preference order: a member the current library already references (keeps
 * the library link intact), then the most complete/linked record. Ties break
 * on original order for determinism.
 */
export function pickDefaultSurvivor(
  members: Candidate[],
  isInLibrary?: (c: Candidate) => boolean,
): number {
  let best = 0;
  let bestScore = -Infinity;
  members.forEach((c, i) => {
    const libBonus = isInLibrary?.(c) ? 1_000_000 : 0;
    const score = libBonus + completenessScore(c);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Fold `victims` into `survivor`, filling only the survivor's empty metadata
 * fields (survivor's own non-null values always win) and keeping the earliest
 * `addedAt`. Identity and user-intent fields (title, downvoted, removed*) are
 * taken from the survivor untouched.
 */
export function mergeCandidates(
  survivor: Candidate,
  victims: Candidate[],
): Candidate {
  const merged: Candidate = { ...survivor };
  const sources = [survivor, ...victims];

  for (const f of FILL_FIELDS) {
    if (!isEmpty(merged[f])) continue;
    for (const s of sources) {
      const v = s[f];
      if (!isEmpty(v)) {
        // Field-by-field copy across a shared key set; the cast keeps the
        // loop generic without widening `merged` to `any`.
        (merged as Record<keyof Candidate, unknown>)[f] = v;
        break;
      }
    }
  }

  const times = sources.map((s) => s.addedAt).filter(Boolean);
  if (times.length > 0) {
    merged.addedAt = times.reduce((a, b) => (a < b ? a : b));
  }

  return merged;
}

/**
 * Produce the new pool array with `victims` removed and `survivor` replaced by
 * the merged record. Operates on object reference identity (not title) so it
 * stays correct even when two rows share an identical title string.
 */
export function applyMerge(
  candidates: Candidate[],
  survivor: Candidate,
  victims: Candidate[],
): Candidate[] {
  const victimSet = new Set(victims);
  const merged = mergeCandidates(survivor, victims);
  return candidates
    .filter((c) => !victimSet.has(c))
    .map((c) => (c === survivor ? merged : c));
}

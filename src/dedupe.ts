import { titleAliasEvidence, type TitleAliasEvidence } from './titleAliasEvidence';
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
  /** Whole group has one confirmed IMDb identity and no conflicting years. */
  confirmedIdentity?: boolean;
  aliasEvidence?: TitleAliasEvidence[];
};

/**
 * Metadata fields folded from victims into the survivor when a value is
 * missing on the survivor. Intentionally excludes identity/user-intent fields
 * (`title`, `addedAt`, `downvoted`, `removedReason`, `removedAt`) which are
 * handled explicitly or preserved from the survivor.
 */
const FILL_FIELDS: (keyof Candidate)[] = [
  'year',
  'releaseDate',
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
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Review-only title evidence: punctuation, alternate display titles, Roman
 * sequel numbers and a long numbered franchise title with/without subtitle.
 * These signals NEVER authorize an automatic merge. */
export function possibleTitleVariant(a: string, b: string): boolean {
  const normalize = (title: string) => dedupKey(title).split(' ').map(token => ({ii:'2',iii:'3',iv:'4',v:'5',vi:'6'}[token] ?? token)).join(' ');
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const numbers = (title: string) => title.match(/\b\d+\b/g)?.join(',') ?? '';
  const xNumbers = numbers(x), yNumbers = numbers(y);
  // An explicit different installment is never an alias. In particular,
  // stripping 2 and 3 must not bridge an entire franchise via union-find.
  if (xNumbers && yNumbers && xNumbers !== yNumbers) return false;
  const withoutNumbers = (title: string) => title.split(' ').filter(token => !/^\d+$/.test(token)).join(' ');
  const xn = withoutNumbers(x), yn = withoutNumbers(y);
  // The only omitted-number match is an embedded number with a subtitle:
  // "Dragon 3 The Hidden World" ↔ "Dragon The Hidden World". A trailing
  // number ("Dragon" ↔ "Dragon 3") denotes a different installment.
  const numbered = xNumbers && !yNumbers ? x : yNumbers && !xNumbers ? y : null;
  if (numbered && /\b\d+\s+\D/.test(numbered) && xn === yn && xn.split(' ').length >= 4) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  return shorter.split(' ').length >= 4 && !!numbers(shorter) && numbers(shorter) === numbers(longer) && longer.startsWith(shorter + ' ');
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
  const live = candidates.filter((c) => c.removedAt == null && c.removedReason == null);

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

  // Pairwise scan is bounded by the local catalog and uses token rules only;
  // no provider lookup or fuzzy-confidence score can turn this into auto merge.
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = [live[i].title, live[i].displayTitle].filter((v): v is string => !!v);
    const b = [live[j].title, live[j].displayTitle].filter((v): v is string => !!v);
    if (a.some(x => b.some(y => possibleTitleVariant(x, y) || titleAliasEvidence(x, y)))) union(i, j);
  }

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
    const confirmedIdentity = ids.length === members.length && new Set(ids).size === 1 && new Set(members.map(m => m.year).filter(y => y != null)).size <= 1;
    const evidence = new Map<string, TitleAliasEvidence>();
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      for (const a of [members[i].title, members[i].displayTitle]) for (const b of [members[j].title, members[j].displayTitle]) {
        const match = a && b ? titleAliasEvidence(a, b) : undefined;
        if (match) evidence.set(match.sourceUrl, match);
      }
    }
    groups.push({ aliasEvidence: [...evidence.values()], key: dedupKey(members[0].title), members, sharesImdbId, confirmedIdentity });
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

/** Reason stamped on the victim rows a merge folds away. */
export const MERGED_REASON = 'Merged duplicate';

/**
 * Victims whose non-null IMDb id differs from the survivor's. A distinct IMDb
 * id is a hard signal that two rows are DIFFERENT movies (OMDB mints one id per
 * title), so folding them together is almost always a mistake — this is the
 * "Shaun the Sheep" false-merge, where the 2015 film and the 2019 sequel were
 * combined. The review surfaces these loudly before the admin merges.
 */
export function conflictingIds(
  survivor: Candidate,
  victims: Candidate[],
): Candidate[] {
  if (survivor.imdbId == null) return [];
  return victims.filter(
    (v) => v.imdbId != null && v.imdbId !== survivor.imdbId,
  );
}

/**
 * Fold `victims` into `survivor`, filling only the survivor's empty metadata
 * fields (survivor's own non-null values always win) and keeping the earliest
 * `addedAt`. The survivor's own `title` is kept as its identity. Two user
 * signals are preserved rather than dropped: the earliest `addedAt`, and a
 * `downvoted` flag from *any* member — if the user suppressed one copy of a
 * movie, merging its duplicates shouldn't quietly un-suppress it. The survivor
 * is never itself removed, so `removed*` come from the (non-removed) survivor.
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

  if (sources.some((s) => s.downvoted)) merged.downvoted = true;

  return merged;
}

/**
 * Stable value signature for a candidate. Used to locate the survivor/victim
 * rows in the *current* pool at merge time. Object reference identity can't be
 * used: the realtime subscription re-parses the whole pool into fresh objects
 * on every write (including our own), so a snapshot taken when the review
 * opened holds references that no longer exist in `pool.candidates` after the
 * first merge — which silently no-oped every subsequent merge. These fields
 * all round-trip through JSON unchanged, so the signature survives a reload.
 */
export function candidateKey(c: Candidate): string {
  return [c.imdbId ?? '', c.title.toLowerCase(), c.year ?? '', c.addedAt ?? ''].join(
    ' ',
  );
}

/**
 * Produce the new pool array with the survivor enriched and each victim
 * **soft-removed** (not deleted). This is deliberate and load-bearing for
 * safety: `findCandidate` (src/useMovies.ts) resolves a library entry to *any*
 * matching candidate, including soft-removed ones — so keeping the victim row
 * in the pool guarantees that a watched/wishlist movie in ANY family that
 * pointed at a merged-away duplicate stays linked and keeps its metadata,
 * rather than silently orphaning. Meanwhile `findDuplicateGroups` and the
 * recommender both exclude `removed*` rows, so the duplicate disappears from
 * the dedupe scan and from "For You", and it stays on the expansion ban list
 * so Claude won't re-suggest it. A mis-merge is fully reversible via Restore.
 *
 * Rows are matched by value signature (see `candidateKey`), not object
 * identity, so this stays correct across the realtime reload that follows each
 * write and when two rows share an identical title. Victim keys are consumed
 * as a multiset so genuinely identical duplicate rows collapse correctly.
 * Already-removed rows are skipped entirely — they can never be a live target,
 * so they neither consume a victim slot nor get restamped/resurrected.
 */
export function applyMerge(
  candidates: Candidate[],
  survivor: Candidate,
  victims: Candidate[],
  now: string = new Date().toISOString(),
): Candidate[] {
  if (victims.length === 0) return candidates;
  const survivorKey = candidateKey(survivor);
  const victimCounts = new Map<string, number>();
  for (const v of victims) {
    const k = candidateKey(v);
    victimCounts.set(k, (victimCounts.get(k) ?? 0) + 1);
  }

  let survivorReplaced = false;
  return candidates.map((c) => {
    // Never touch an already-removed row: the review only ever targets live
    // rows, so a removed row here is unrelated and must not consume a victim's
    // multiset slot (which would leave the real live victim un-merged).
    if (c.removedAt != null) return c;

    const k = candidateKey(c);
    const remaining = victimCounts.get(k) ?? 0;
    // Soft-remove a victim row (skip a survivor that shares the victim's
    // signature — pure-duplicate case — so the survivor still lands below).
    if (remaining > 0 && !(k === survivorKey && !survivorReplaced)) {
      victimCounts.set(k, remaining - 1);
      return { ...c, removedReason: MERGED_REASON, removedAt: now };
    }
    if (!survivorReplaced && k === survivorKey) {
      survivorReplaced = true;
      // Merge onto the LIVE survivor row `c`, not the review snapshot, so a
      // concurrent edit to the survivor between snapshot and merge isn't
      // clobbered by stale data (its own non-empty fields still win).
      return mergeCandidates(c, victims);
    }
    return c;
  });
}


/** Only wholly confirmed groups are combined; ambiguous chains stay for review.
 * Soft removal retains every alias row for family title-based references. */
export function combineConfirmedDuplicates(candidates: Candidate[], isInLibrary?: (c: Candidate) => boolean): { candidates: Candidate[]; combined: number } {
  let next = candidates;
  let combined = 0;
  for (const group of findDuplicateGroups(candidates)) {
    if (!group.confirmedIdentity) continue;
    const index = pickDefaultSurvivor(group.members, isInLibrary);
    const victims = group.members.filter((_, i) => i !== index);
    next = applyMerge(next, group.members[index], victims);
    combined += victims.length;
  }
  return { candidates: next, combined };
}

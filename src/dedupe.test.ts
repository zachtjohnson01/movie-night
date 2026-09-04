import { describe, it, expect } from 'vitest';
import type { Candidate } from './types';
import {
  findDuplicateGroups,
  combineConfirmedDuplicates,
  possibleTitleVariant,
  mergeCandidates,
  applyMerge,
  pickDefaultSurvivor,
  completenessScore,
  conflictingIds,
  MERGED_REASON,
} from './dedupe';

function cand(partial: Partial<Candidate> & { title: string }): Candidate {
  const base: Candidate = {
    title: '',
    year: null,
    imdbId: null,
    imdb: null,
    rottenTomatoes: null,
    commonSenseAge: null,
    studio: null,
    awards: null,
    poster: null,
    addedAt: '2024-01-01T00:00:00.000Z',
  };
  return { ...base, ...partial };
}

describe('findDuplicateGroups', () => {
  it('groups candidates that share a title dedup key', () => {
    const pool = [
      cand({ title: 'The Lion King', imdbId: 'tt1' }),
      cand({ title: 'Lion King', imdbId: 'tt2' }),
      cand({ title: 'Frozen', imdbId: 'tt3' }),
    ];
    const groups = findDuplicateGroups(pool);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.title).sort()).toEqual([
      'Lion King',
      'The Lion King',
    ]);
  });

  it('groups candidates that share an imdbId even with different titles', () => {
    const pool = [
      cand({ title: 'Star Wars', imdbId: 'tt0076759' }),
      cand({ title: 'Star Wars: A New Hope', imdbId: 'tt0076759' }),
    ];
    const groups = findDuplicateGroups(pool);
    expect(groups).toHaveLength(1);
    expect(groups[0].sharesImdbId).toBe(true);
  });

  it('flags title-only groups as not sharing an imdbId (possible remake)', () => {
    const pool = [
      cand({ title: 'The Lion King', imdbId: 'tt0110357', year: 1994 }),
      cand({ title: 'The Lion King', imdbId: 'tt6105098', year: 2019 }),
    ];
    const groups = findDuplicateGroups(pool);
    expect(groups).toHaveLength(1);
    expect(groups[0].sharesImdbId).toBe(false);
  });

  it('collapses a transitive chain into one group', () => {
    // A~B by title, B~C by imdbId => {A,B,C}
    const pool = [
      cand({ title: 'Cars', imdbId: 'ttA' }),
      cand({ title: 'Cars', imdbId: 'ttSHARED' }),
      cand({ title: 'Cars (2006)', imdbId: 'ttSHARED' }),
    ];
    const groups = findDuplicateGroups(pool);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it('excludes soft-removed candidates', () => {
    const pool = [
      cand({ title: 'Up', imdbId: 'tt1' }),
      cand({ title: 'Up', imdbId: 'tt2', removedAt: '2024-02-01T00:00:00Z' }),
    ];
    expect(findDuplicateGroups(pool)).toHaveLength(0);
  });

  it('returns strong-signal groups before title-only groups', () => {
    const pool = [
      cand({ title: 'Remake', imdbId: 'tt10', year: 1980 }),
      cand({ title: 'Remake', imdbId: 'tt11', year: 2010 }),
      cand({ title: 'Dupe', imdbId: 'ttSAME' }),
      cand({ title: 'Dupe Movie', imdbId: 'ttSAME' }),
    ];
    const groups = findDuplicateGroups(pool);
    expect(groups[0].sharesImdbId).toBe(true);
    expect(groups[1].sharesImdbId).toBe(false);
  });

  it('finds nothing when there are no duplicates', () => {
    const pool = [
      cand({ title: 'A', imdbId: 'tt1' }),
      cand({ title: 'B', imdbId: 'tt2' }),
    ];
    expect(findDuplicateGroups(pool)).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('fills empty survivor fields from victims without overwriting present ones', () => {
    const survivor = cand({ title: 'Toy Story', imdbId: 'tt1', rottenTomatoes: '100%' });
    const victim = cand({
      title: 'Toy Story',
      imdbId: 'tt1',
      rottenTomatoes: '95%',
      imdb: '8.3',
      studio: 'Pixar',
    });
    const merged = mergeCandidates(survivor, [victim]);
    expect(merged.rottenTomatoes).toBe('100%'); // survivor wins
    expect(merged.imdb).toBe('8.3'); // filled from victim
    expect(merged.studio).toBe('Pixar');
    expect(merged.title).toBe('Toy Story');
  });

  it('unions the imdbId from a victim when the survivor is unlinked', () => {
    const survivor = cand({ title: 'Lion King', imdbId: null });
    const victim = cand({ title: 'The Lion King', imdbId: 'tt0110357' });
    const merged = mergeCandidates(survivor, [victim]);
    expect(merged.imdbId).toBe('tt0110357');
  });

  it('keeps the earliest addedAt', () => {
    const survivor = cand({ title: 'X', addedAt: '2024-05-01T00:00:00Z' });
    const victim = cand({ title: 'X', addedAt: '2023-01-01T00:00:00Z' });
    expect(mergeCandidates(survivor, [victim]).addedAt).toBe(
      '2023-01-01T00:00:00Z',
    );
  });

  it('treats an empty array as missing so real creator lists are inherited', () => {
    const survivor = cand({ title: 'A', imdbId: 'tt1', directors: [] });
    const victim = cand({ title: 'A', imdbId: 'tt1', directors: ['Brad Bird'] });
    expect(mergeCandidates(survivor, [victim]).directors).toEqual(['Brad Bird']);
  });
});

describe('applyMerge', () => {
  const NOW = '2026-01-01T00:00:00.000Z';

  it('soft-removes victims (keeps the row) and enriches the survivor', () => {
    const a = cand({ title: 'Lion King', imdbId: null, studio: null });
    const b = cand({ title: 'The Lion King', imdbId: 'tt1', studio: 'Disney' });
    const c = cand({ title: 'Frozen', imdbId: 'tt2' });
    const next = applyMerge([a, b, c], a, [b], NOW);
    // Nothing is deleted — the pool keeps all three rows.
    expect(next).toHaveLength(3);
    const survivor = next.find((x) => x.title === 'Lion King')!;
    expect(survivor.imdbId).toBe('tt1');
    expect(survivor.studio).toBe('Disney');
    expect(survivor.removedAt).toBeFalsy(); // survivor stays active
    const victim = next.find((x) => x.title === 'The Lion King')!;
    expect(victim.removedAt).toBe(NOW); // victim soft-removed, still present
    expect(victim.removedReason).toBe(MERGED_REASON);
    expect(next.find((x) => x.title === 'Frozen')!.removedAt).toBeFalsy();
  });

  it('keeps a merged-away title resolvable so library entries are not orphaned', () => {
    // A library entry references the victim by imdbId. After merge, the victim
    // row must still exist (soft-removed) so findCandidate can resolve it.
    const survivor = cand({ title: 'Cars', imdbId: 'tt1' });
    const victim = cand({ title: 'Cars', imdbId: 'ttLIB', year: 2006 });
    const next = applyMerge([survivor, victim], survivor, [victim], NOW);
    expect(next.find((c) => c.imdbId === 'ttLIB')).toBeTruthy();
  });

  it('drops merged rows from a re-scan (regression: no re-finding the same dupes)', () => {
    const a = cand({ title: 'Up', imdbId: 'tt1' });
    const b = cand({ title: 'Up', imdbId: 'tt2' });
    const c = cand({ title: 'Frozen', imdbId: 'tt3' });
    expect(findDuplicateGroups([a, b, c])).toHaveLength(1);
    const merged = applyMerge([a, b, c], a, [b], NOW);
    expect(findDuplicateGroups(merged)).toHaveLength(0);
  });

  it('preserves a downvote from any member', () => {
    const survivor = cand({ title: 'X', imdbId: 'tt1' });
    const victim = cand({ title: 'X', imdbId: 'tt2', downvoted: true });
    const next = applyMerge([survivor, victim], survivor, [victim], NOW);
    expect(next.find((c) => c.imdbId === 'tt1')!.downvoted).toBe(true);
  });

  it('matches by value, not reference, so it survives a realtime reload', () => {
    // Simulate the pool being re-parsed from JSON: the live array holds fresh
    // objects that are value-equal to the review snapshot but not identical.
    const snapSurvivor = cand({ title: 'Lion King', imdbId: null });
    const snapVictim = cand({ title: 'The Lion King', imdbId: 'tt1', studio: 'Disney' });
    const reloadedPool = [
      cand({ title: 'Lion King', imdbId: null }),
      cand({ title: 'The Lion King', imdbId: 'tt1', studio: 'Disney' }),
      cand({ title: 'Frozen', imdbId: 'tt2' }),
    ];
    const next = applyMerge(reloadedPool, snapSurvivor, [snapVictim], NOW);
    const survivor = next.find((x) => x.title === 'Lion King')!;
    expect(survivor.imdbId).toBe('tt1');
    expect(survivor.removedAt).toBeFalsy();
    expect(next.find((x) => x.title === 'The Lion King')!.removedAt).toBe(NOW);
  });

  it('collapses identical-signature rows to one active + one removed', () => {
    const survivor = cand({ title: 'Dupe', imdbId: 'tt1' });
    const victim = cand({ title: 'Dupe', imdbId: 'tt1', imdb: '7.0' });
    const next = applyMerge([survivor, victim], survivor, [victim], NOW);
    expect(next).toHaveLength(2);
    const active = next.filter((c) => c.removedAt == null);
    expect(active).toHaveLength(1);
    expect(active[0].imdb).toBe('7.0');
    expect(active[0].imdbId).toBe('tt1');
  });

  it('merges only the selected subset of a 3-member group', () => {
    const keeper = cand({ title: 'Cars', imdbId: 'tt1' });
    const foldIn = cand({ title: 'Cars ', imdbId: null, studio: 'Pixar' });
    const leaveOut = cand({ title: 'Cars', imdbId: 'tt9', year: 2011 });
    const next = applyMerge([keeper, foldIn, leaveOut], keeper, [foldIn], NOW);
    // The left-out member stays active; only the folded-in one is removed.
    expect(next.find((x) => x.imdbId === 'tt9')!.removedAt).toBeFalsy();
    expect(next.find((x) => x.imdbId == null)!.removedAt).toBe(NOW);
    expect(next.find((x) => x.imdbId === 'tt1')!.studio).toBe('Pixar');
  });

  it('does not let an already-removed twin block a live victim from merging', () => {
    // A previously-removed row shares the live victim's exact signature. It
    // must not consume the victim's multiset slot (that would leave the real
    // duplicate active).
    const survivor = cand({ title: 'Up', imdbId: 'ttS' });
    const removedTwin = cand({
      title: 'Up',
      imdbId: 'ttV',
      year: 2009,
      removedAt: '2020-01-01T00:00:00Z',
      removedReason: 'TV show',
    });
    const liveVictim = cand({ title: 'Up', imdbId: 'ttV', year: 2009 });
    const next = applyMerge(
      [survivor, removedTwin, liveVictim],
      survivor,
      [liveVictim],
      NOW,
    );
    const active = next.filter((c) => c.removedAt == null);
    expect(active.map((c) => c.imdbId)).toEqual(['ttS']); // only survivor live
    expect(next.find((c) => c.removedReason === 'TV show')).toBeTruthy();
    expect(next.filter((c) => c.removedReason === MERGED_REASON)).toHaveLength(1);
  });

  it('does not restamp an already-removed victim', () => {
    const survivor = cand({ title: 'A', imdbId: 'tt1' });
    const already = cand({
      title: 'A',
      imdbId: 'tt2',
      removedAt: '2020-01-01T00:00:00Z',
      removedReason: 'TV show',
    });
    const next = applyMerge([survivor, already], survivor, [already], NOW);
    const row = next.find((c) => c.imdbId === 'tt2')!;
    expect(row.removedAt).toBe('2020-01-01T00:00:00Z');
    expect(row.removedReason).toBe('TV show');
  });

  it('is a no-op when no victims are selected', () => {
    const a = cand({ title: 'A', imdbId: 'tt1' });
    const b = cand({ title: 'A', imdbId: 'tt2' });
    expect(applyMerge([a, b], a, [], NOW)).toEqual([a, b]);
  });
});

describe('pickDefaultSurvivor', () => {
  it('prefers a member already in the library', () => {
    const inLib = cand({ title: 'Lion King', imdbId: null });
    const richer = cand({ title: 'The Lion King', imdbId: 'tt1', studio: 'Disney' });
    const idx = pickDefaultSurvivor([richer, inLib], (c) => c === inLib);
    expect([richer, inLib][idx]).toBe(inLib);
  });

  it('falls back to the most complete/linked record', () => {
    const sparse = cand({ title: 'A', imdbId: null });
    const linked = cand({ title: 'A', imdbId: 'tt1', studio: 'S' });
    const idx = pickDefaultSurvivor([sparse, linked]);
    expect([sparse, linked][idx]).toBe(linked);
  });
});

describe('conflictingIds', () => {
  it('flags a victim whose non-null imdbId differs from the survivor (the Shaun bug)', () => {
    const keep = cand({ title: 'Shaun the Sheep Movie', imdbId: 'tt2872750' });
    const other = cand({
      title: 'A Shaun the Sheep Movie: Farmageddon',
      imdbId: 'tt6193408',
    });
    expect(conflictingIds(keep, [other])).toHaveLength(1);
  });

  it('does not flag a victim that shares the survivor imdbId', () => {
    const keep = cand({ title: 'Cars', imdbId: 'tt1' });
    const dup = cand({ title: 'Cars', imdbId: 'tt1' });
    expect(conflictingIds(keep, [dup])).toEqual([]);
  });

  it('does not flag an unlinked victim (safe to fold in)', () => {
    const keep = cand({ title: 'Cars', imdbId: 'tt1' });
    const unlinked = cand({ title: 'Cars', imdbId: null });
    expect(conflictingIds(keep, [unlinked])).toEqual([]);
  });

  it('never flags when the survivor is unlinked', () => {
    const keep = cand({ title: 'Cars', imdbId: null });
    const linked = cand({ title: 'Cars', imdbId: 'tt9' });
    expect(conflictingIds(keep, [linked])).toEqual([]);
  });
});

describe('completenessScore', () => {
  it('rewards linked candidates heavily', () => {
    const linked = cand({ title: 'A', imdbId: 'tt1' });
    const unlinkedRich = cand({
      title: 'A',
      studio: 'S',
      awards: 'W',
      imdb: '9',
      year: 2000,
    });
    expect(completenessScore(linked)).toBeGreaterThan(
      completenessScore(unlinkedRich),
    );
  });
});


describe('alternate title scan safety', () => {
  it('finds the reported Dragon subtitle and sequel-number variants without auto-merging conflicting records', () => {
    const records = [
      cand({title:'How to Train Your Dragon: The Hidden World',year:2019,imdbId:'tt2386490'}),
      cand({title:'How to Train Your Dragon 3: The Hidden World',year:2019}),
      cand({title:'How to Train Your Dragon 3',year:2020,imdbId:'tt6726906'}),
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].confirmedIdentity).toBe(false);
    expect(combineConfirmedDuplicates(records).combined).toBe(0);
  });
  it('recognizes display-title aliases and Roman sequel numerals as review evidence', () => {
    const records = [cand({title:'Local title',displayTitle:'Adventure Part III',imdbId:'tt1'}),cand({title:'Adventure Part 3',imdbId:'tt2'})];
    expect(findDuplicateGroups(records)).toHaveLength(1);
    expect(combineConfirmedDuplicates(records).combined).toBe(0);
  });
  it('only combines wholly confirmed groups with compatible years and preserves alias rows', () => {
    const records = [cand({title:'Original title',year:2019,imdbId:'tt1',releaseDate:'2019-02-01'}),cand({title:'Alias',year:2019,imdbId:'tt1',downvoted:true})];
    const result = combineConfirmedDuplicates(records,c => c.title === 'Alias');
    expect(result.combined).toBe(1);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find(c => c.title === 'Alias')).toMatchObject({releaseDate:'2019-02-01',downvoted:true});
    expect(result.candidates.find(c => c.title === 'Original title')?.removedReason).toBe(MERGED_REASON);
    expect(combineConfirmedDuplicates(result.candidates).combined).toBe(0);
    expect(combineConfirmedDuplicates([records[0],{...records[1],year:2020}]).combined).toBe(0);
  });
  it('does not auto-merge a mixed chain just because a subset shares an IMDb ID', () => {
    const records = [cand({title:'Film',imdbId:'tt1'}),cand({title:'Alias',imdbId:'tt1'}),cand({title:'Alias',imdbId:'tt2'})];
    expect(findDuplicateGroups(records)[0].sharesImdbId).toBe(true);
    expect(combineConfirmedDuplicates(records).combined).toBe(0);
  });
});


describe('franchise installment regression', () => {
  it('groups only the three third-film records, leaving Dragon 1 and 2 separate', () => {
    const original = cand({title:'How to Train Your Dragon',year:2010,imdbId:'tt0892769'});
    const sequel = cand({title:'How to Train Your Dragon 2',year:2014,imdbId:'tt1646971'});
    const third = [
      cand({title:'How to Train Your Dragon: The Hidden World',year:2019,imdbId:'tt2386490'}),
      cand({title:'How to Train Your Dragon 3: The Hidden World',year:2019,imdbId:null}),
      cand({title:'How to Train Your Dragon 3',year:2020,imdbId:'tt6726906'}),
    ];
    const groups = findDuplicateGroups([original,sequel,...third]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toEqual(third);
    expect(groups[0].confirmedIdentity).toBe(false);
    expect(combineConfirmedDuplicates([original,sequel,...third]).combined).toBe(0);
  });
  it('never strips trailing installment numbers or collapses conflicting numbered subtitles', () => {
    const base = 'How to Train Your Dragon';
    expect(possibleTitleVariant(base,base+' 2')).toBe(false);
    expect(possibleTitleVariant(base+' 2',base+' 3')).toBe(false);
    expect(possibleTitleVariant(base+' II',base+' III')).toBe(false);
    expect(possibleTitleVariant(base+' 2: The Hidden World',base+' 3: The Hidden World')).toBe(false);
    expect(possibleTitleVariant(base+' 3: The Hidden World',base+': The Hidden World')).toBe(true);
  });
  it('keeps Pets installments separate and uses evidence, not fuzzy stems, for Minions aliases', () => {
    expect(possibleTitleVariant('Pets','Pets 2')).toBe(false);
    expect(possibleTitleVariant('The Secret Life of Pets','The Secret Life of Pets 2')).toBe(false);
    expect(possibleTitleVariant('Minions 3','Minions & Monsters')).toBe(false);
    const records = [
      cand({title:'The Secret Life of Pets',year:2016,imdbId:'tt2709768'}),
      cand({title:'The Secret Life of Pets 2',year:2019,imdbId:'tt5113040'}),
      cand({title:'Minions 3',year:2016,imdbId:'tt6173116'}),
      cand({title:'Minions & Monsters',year:2026}),
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toEqual(records.slice(2));
    expect(groups[0].aliasEvidence?.[0].sourceUrl).toContain('universalpicturesathome.com');
    expect(combineConfirmedDuplicates(records).combined).toBe(0);
  });

});


describe('source-backed numbered title suggestions', () => {
  it('reviews Minions 3 against Monsters without pulling in other Minions films', () => {
    const records = [cand({title:'Minions',year:2015}),cand({title:'Minions 2',year:2022}),cand({title:'Minions: The Rise of Gru',year:2022}),cand({title:'Minions 3',year:2016,imdbId:'tt6173116'}),cand({title:'Minions & Monsters',year:2026,imdbId:'tt-m'} )];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(c=>c.title)).toEqual(['Minions 3','Minions & Monsters']);
    expect(groups[0].confirmedIdentity).toBe(false);
    expect(groups[0].aliasEvidence?.[0].explanation).toContain('collection');
    expect(combineConfirmedDuplicates(records).combined).toBe(0);
  });
  it('does not group unrelated titles because both have missing posters or links', () => {
    expect(findDuplicateGroups([cand({title:'Unknown A'}),cand({title:'Unknown B'})])).toHaveLength(0);
  });
});

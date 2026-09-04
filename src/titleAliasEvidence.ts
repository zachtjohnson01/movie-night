/** Reviewed release metadata, not a fuzzy franchise matcher. New entries need
 * a publisher/studio source establishing the installment and canonical title.
 * These are suggestions about intended titles, never proof that stored IDs
 * identify the same film (older collections can reuse a numbered label). */
export type TitleAliasEvidence = {
  canonicalTitle: string;
  franchiseTitle: string;
  installment: number;
  releaseYear: number;
  sourceUrl: string;
  sourceLabel: string;
  explanation: string;
};
export const RELEASE_ALIAS_EVIDENCE: readonly TitleAliasEvidence[] = [{
  canonicalTitle: 'Minions & Monsters',
  franchiseTitle: 'Minions',
  installment: 3,
  releaseYear: 2026,
  sourceUrl: 'https://www.universalpicturesathome.com/press-release/minions-monsters-press-release',
  sourceLabel: 'Universal Pictures release announcement',
  explanation: 'Universal identifies Minions & Monsters (2026) as the third Minions film. A record named Minions 3 may have intended this title. An older year or different IMDb link may instead identify a collection or another film; review before combining.',
}];
const key = (title: string) => title.toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

export function titleAliasEvidence(a: string, b: string): TitleAliasEvidence | undefined {
  const x = key(a), y = key(b);
  return RELEASE_ALIAS_EVIDENCE.find(evidence => {
    const canonical = key(evidence.canonicalTitle);
    const numbered = key(`${evidence.franchiseTitle} ${evidence.installment}`);
    return (x === canonical && y === numbered) || (y === canonical && x === numbered);
  });
}

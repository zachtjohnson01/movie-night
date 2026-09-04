import type { StreamingInfo, StreamingProvider } from '../types';
import { appSearchUrl, hasStreamingProviders, offerPrice } from '../watchmode';

/**
 * "Where to watch" card: provider logo tiles grouped into Stream / Rent / Buy,
 * sourced from Watchmode. Shared by the movie Detail screen and the pool admin
 * edit sheet so the display stays identical everywhere.
 *
 * Each tile links via the provider's per-title deep link (Watchmode `web_url`),
 * which universal-links into the service's app on mobile / opens the website on
 * desktop. When a provider has no deep link, it falls back to an in-app search
 * for `searchTitle`, then the region-level link. Renders nothing without data.
 */
export default function StreamingSection({
  streaming,
  searchTitle,
  className = 'mt-5',
}: {
  streaming: StreamingInfo | null;
  searchTitle?: string;
  className?: string;
}) {
  if (!streaming || !hasStreamingProviders(streaming)) return null;

  const groups: Array<{ label: string; providers: StreamingProvider[] }> = [
    { label: 'Stream', providers: streaming.stream },
    { label: 'Rent', providers: streaming.rent },
    { label: 'Buy', providers: streaming.buy },
  ].filter((g) => g.providers.length > 0);

  const checked = Date.parse(streaming.fetchedAt);

  return (
    <div
      className={`${className} rounded-2xl bg-ink-900/70 border border-ink-800 p-4 space-y-4`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
          Where to watch{streaming.region ? ` · ${streaming.region}` : ''}
        </div>
        <span className="text-[10px] text-ink-600">via Watchmode</span>
      </div>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
            {g.label}
          </div>
          <div className={g.label === 'Stream' ? 'mt-2 flex flex-wrap gap-2' : 'mt-2 space-y-2'}>
            {g.label === 'Stream' ? g.providers.map((p,index) => <ProviderTile key={`${p.id}-${index}`} provider={p} paid={false} fallbackLink={streaming.link} searchTitle={searchTitle} />) : groupProviders(g.providers).map(offers => <ProviderRow key={offers[0].id} providers={offers} kind={g.label} fallbackLink={streaming.link} searchTitle={searchTitle} />)}
          </div>
        </div>
      ))}
      <p className="text-xs text-ink-300">
        {Number.isFinite(checked) ? `Checked ${new Date(checked).toLocaleDateString('en-US')}. ` : 'Last check unknown. '}
        Prices and availability may change; confirm with the service.
      </p>
    </div>
  );
}

function ProviderTile({
  provider,
  paid,
  fallbackLink,
  searchTitle,
}: {
  provider: StreamingProvider;
  paid: boolean;
  fallbackLink: string | null;
  searchTitle?: string;
}) {
  // Prefer the real per-title deep link; else an in-app search for the title;
  // else the region-level link. Disabled-looking tile if we have nothing.
  const link =
    provider.link ||
    (searchTitle ? appSearchUrl(provider.name, searchTitle) : null) ||
    fallbackLink;

  const cls =
    'min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-ink-800 border border-ink-700 pl-1.5 pr-3 active:bg-ink-700';
  const inner = (
    <>
      {provider.logo ? (
        <img
          src={provider.logo}
          alt=""
          className="w-9 h-9 rounded-lg"
          loading="lazy"
        />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-ink-700 flex items-center justify-center text-[10px] font-semibold text-ink-300">
          {provider.name.slice(0, 2)}
        </div>
      )}
      <span className="py-2 min-w-0">
        <span className="block text-sm text-ink-100 font-medium">{provider.name}</span>
        <span className="block text-xs text-ink-300">
          {paid ? offerPrice(provider) : provider.accessType === 'sub' ? 'With subscription' : provider.accessType === 'free' ? 'Free · ads may apply' : provider.accessType === 'tve' ? 'TV provider sign-in' : 'Check access'}
          {provider.format ? ` · ${provider.format}` : ''}
        </span>
      </span>
    </>
  );
  if (!link) return <div className={cls}>{inner}</div>;
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  );
}

function groupProviders(providers: StreamingProvider[]): StreamingProvider[][] {
  const groups = new Map<string, StreamingProvider[]>();
  for (const provider of providers) {
    const key = String(provider.id ?? provider.name.toLowerCase());
    groups.set(key, [...(groups.get(key) ?? []), provider]);
  }
  return [...groups.values()];
}

function ProviderRow({ providers, kind, fallbackLink, searchTitle }: {
  providers: StreamingProvider[]; kind: string; fallbackLink: string | null; searchTitle?: string;
}) {
  const provider = providers[0];
  // Group equal prices but preserve separate format links, even when a
  // provider sends a different purchase URL for each format.
  const prices = new Map<string, StreamingProvider[]>();
  for (const offer of providers) {
    const price = offerPrice(offer);
    const bucket = prices.get(price) ?? [];
    if (!bucket.some(p => p.format === offer.format && p.link === offer.link)) bucket.push(offer);
    prices.set(price, bucket);
  }
  return <div role="group" aria-label={`${provider.name} ${kind.toLowerCase()} offers`} className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-ink-700 bg-ink-800 p-3">
    <div className="w-20 shrink-0 min-w-0">
      {provider.logo && <img src={provider.logo} alt="" loading="lazy" className="h-9 w-9 rounded-lg" />}
      <span className="mt-1 block text-xs font-semibold leading-snug text-ink-100 break-words">{provider.name}</span>
    </div>
    <div className="min-w-0 flex-1 space-y-1">
      {[...prices].map(([price,offers]) => <div key={price} className="min-w-0">
        <span className="block text-sm font-semibold tabular-nums text-ink-100">{price}</span>
        <div className="flex flex-wrap gap-1">{offers.map((offer,index) => {
          const link = offer.link || (searchTitle ? appSearchUrl(offer.name,searchTitle) : null) || fallbackLink;
          const format = offer.format || 'View offer';
          const cls = 'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-ink-700 px-2 text-xs text-amber-glow active:bg-ink-700 break-words';
          return link ? <a key={index} href={link} target="_blank" rel="noopener noreferrer" aria-label={`${provider.name} ${kind.toLowerCase()} ${format}: ${price}`} className={cls}>{format}</a> : <span key={index} className={cls}>{format}</span>;
        })}</div>
      </div>)}
    </div>
  </div>;
}

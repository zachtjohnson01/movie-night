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
          {g.label === 'Stream' ? <div className="mt-2 flex flex-wrap gap-2">
            {g.providers.map((p,index) => <ProviderTile key={`${p.id}-${index}`} provider={p} paid={false} kind={g.label} fallbackLink={streaming.link} searchTitle={searchTitle} />)}
          </div> : <div className="mt-2 space-y-2">
            {groupProviders(g.providers).map((offers,index) => <div key={index} role="group" aria-label={`${offers[0].name} ${g.label.toLowerCase()} offers`} className="grid gap-2" style={{gridTemplateColumns:`repeat(${offers.length}, minmax(0, 1fr))`}}>
              {offers.map((p,i) => <ProviderTile key={i} provider={p} paid kind={g.label} fallbackLink={streaming.link} searchTitle={searchTitle} />)}
            </div>)}
          </div>}
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
  kind,
  fallbackLink,
  searchTitle,
}: {
  provider: StreamingProvider;
  paid: boolean;
  kind: string;
  fallbackLink: string | null;
  searchTitle?: string;
}) {
  // Prefer the real per-title deep link; else an in-app search for the title;
  // else the region-level link. Disabled-looking tile if we have nothing.
  const link =
    provider.link ||
    (searchTitle ? appSearchUrl(provider.name, searchTitle) : null) ||
    fallbackLink;

  const cls = paid ? 'min-h-[44px] min-w-0 flex flex-col items-center gap-1 rounded-xl bg-ink-800 border border-ink-700 p-2 text-center active:bg-ink-700' :
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
      <span className={paid ? "min-w-0 w-full" : "py-2 min-w-0"}>
        <span className={paid ? "block text-[10px] leading-tight text-ink-100 font-medium break-words" : "block text-sm text-ink-100 font-medium"}>{provider.name}</span>
        <span className="block text-xs text-ink-300">
          {paid ? offerPrice(provider) : provider.accessType === 'sub' ? 'With subscription' : provider.accessType === 'free' ? 'Free · ads may apply' : provider.accessType === 'tve' ? 'TV provider sign-in' : 'Check access'}
          {provider.format && (paid ? <span className="block text-[10px]">{provider.format}</span> : ` · ${provider.format}`)}
        </span>
      </span>
    </>
  );
  if (!link) return <div className={cls}>{inner}</div>;
  return (
    <a aria-label={paid ? `${provider.name} ${kind.toLowerCase()} ${provider.format || 'View offer'}: ${offerPrice(provider)}` : undefined} href={link} target="_blank" rel="noopener noreferrer" className={cls}>
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

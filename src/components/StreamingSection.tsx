import type { StreamingInfo, StreamingProvider } from '../types';
import { hasStreamingProviders } from '../tmdb';

/**
 * "Where to watch" card: provider logo tiles grouped into Stream / Rent / Buy,
 * sourced from TMDB's JustWatch-backed availability. Shared by the movie Detail
 * screen and the pool admin edit sheet so the display stays identical everywhere.
 *
 * Per TMDB's JustWatch agreement there are no per-provider deep links, so every
 * tile points at the single per-region JustWatch/TMDB watch page (which hands
 * off to the service's app via universal links on mobile, or the website on
 * desktop). JustWatch attribution is shown as required. Renders nothing when
 * there's no availability data.
 */
export default function StreamingSection({
  streaming,
  className = 'mt-5',
}: {
  streaming: StreamingInfo | null;
  className?: string;
}) {
  if (!streaming || !hasStreamingProviders(streaming)) return null;

  const groups: Array<{ label: string; providers: StreamingProvider[] }> = [
    { label: 'Stream', providers: streaming.stream },
    { label: 'Rent', providers: streaming.rent },
    { label: 'Buy', providers: streaming.buy },
  ].filter((g) => g.providers.length > 0);

  return (
    <div
      className={`${className} rounded-2xl bg-ink-900/70 border border-ink-800 p-4 space-y-4`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
          Where to watch{streaming.region ? ` · ${streaming.region}` : ''}
        </div>
        <span className="text-[10px] text-ink-600">via JustWatch</span>
      </div>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
            {g.label}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {g.providers.map((p) => (
              <ProviderTile key={p.id} provider={p} link={streaming.link} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderTile({
  provider,
  link,
}: {
  provider: StreamingProvider;
  link: string | null;
}) {
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
      <span className="text-sm text-ink-100 font-medium">{provider.name}</span>
    </>
  );
  if (!link) return <div className={cls}>{inner}</div>;
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  );
}

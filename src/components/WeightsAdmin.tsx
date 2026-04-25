import type { ScoringWeights } from '../scoring';
import WeightsEditor from './WeightsEditor';

type Props = {
  weights: ScoringWeights;
  onSave: (next: ScoringWeights) => Promise<void>;
  onBack: () => void;
};

/**
 * Owner-only screen that hosts the WeightsEditor as a first-class page,
 * reachable from the hamburger menu. The editor itself is unchanged —
 * this wrapper just supplies the screen chrome (back button, eyebrow,
 * title) so it stops being a card buried inside the pool admin screen.
 */
export default function WeightsAdmin({ weights, onSave, onBack }: Props) {
  return (
    <div className="mx-auto max-w-xl pb-8">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-ink-200 active:bg-ink-800"
          >
            <svg
              viewBox="0 0 24 24"
              width={22}
              height={22}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Admin
            </div>
            <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight">
              Scoring weights
            </h1>
          </div>
        </div>
      </header>

      <WeightsEditor weights={weights} onSave={onSave} />
    </div>
  );
}

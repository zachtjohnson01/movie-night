import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_WEIGHTS, type ScoringWeights } from '../scoring';

type Props = {
  weights: ScoringWeights;
  onSave: (next: ScoringWeights) => Promise<void>;
};

type FieldKey = keyof ScoringWeights;

const FIELDS: Array<{ key: FieldKey; label: string; hint: string }> = [
  { key: 'rt', label: 'Rotten Tomatoes', hint: 'Critics %' },
  { key: 'imdb', label: 'IMDb', hint: 'User rating × 10' },
  { key: 'csm', label: 'Common Sense age', hint: 'Target band 5–8' },
  { key: 'studio', label: 'Studio pedigree', hint: 'Ghibli / Pixar / etc.' },
  { key: 'awards', label: 'Awards', hint: 'Oscar wins > wins > nominations' },
  { key: 'director', label: 'Director affinity', hint: 'In your library' },
  { key: 'writer', label: 'Writer affinity', hint: 'In your library' },
];

/**
 * Owner-only editor for the "For You" scoring weights. Weights are integer
 * percentages that must sum to exactly 100 before Save is allowed. On save,
 * the parent persists to Supabase row id=4 via `pool.updateWeights`; the
 * existing rankTopPicks useMemo reruns automatically on the new weights.
 */
export default function WeightsEditor({ weights, onSave }: Props) {
  const [draft, setDraft] = useState<Record<FieldKey, string>>(() =>
    toInputs(weights),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep local draft in sync with upstream weights changes (realtime from
  // the other device, reload after seed). Uses stringified comparison so a
  // no-op realtime replay doesn't stomp on an in-progress edit.
  useEffect(() => {
    const fresh = toInputs(weights);
    setDraft((prev) => {
      const same = (Object.keys(fresh) as FieldKey[]).every(
        (k) => prev[k] === fresh[k],
      );
      return same ? prev : fresh;
    });
  }, [weights]);

  const parsed = useMemo(() => parseDraft(draft), [draft]);
  const total = useMemo(
    () => Object.values(parsed).reduce((a, b) => a + b, 0),
    [parsed],
  );
  const anyInvalid = useMemo(
    () =>
      (Object.keys(parsed) as FieldKey[]).some((k) => {
        const v = parsed[k];
        return !Number.isInteger(v) || v < 0 || v > 100;
      }),
    [parsed],
  );
  const canSave = !saving && !anyInvalid && total === 100;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDraft(toInputs(DEFAULT_WEIGHTS));
    setError(null);
  }

  const savedRecently = savedAt != null && Date.now() - savedAt < 2500;
  const totalColor =
    total === 100
      ? 'text-amber-glow'
      : 'text-crimson-bright';

  return (
    <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl bg-ink-900 border border-ink-700">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-bold text-ink-100">Scoring weights</h3>
        <div className={`text-sm font-mono tabular-nums ${totalColor}`}>
          {total} / 100
        </div>
      </div>
      <p className="mt-1 text-[13px] text-ink-500 leading-relaxed">
        Tune how the For You tab ranks candidates. Must sum to 100. Press
        refresh on the For You tab after saving to re-score picks.
      </p>

      <div className="mt-4 space-y-3">
        {FIELDS.map(({ key, label, hint }) => {
          const raw = draft[key];
          const n = parsed[key];
          const invalid =
            raw !== '' && (!Number.isInteger(n) || n < 0 || n > 100);
          return (
            <label key={key} className="block">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-[13px] text-ink-200 font-semibold">
                    {label}
                  </div>
                  <div className="text-[11px] text-ink-500">{hint}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    autoCorrect="off"
                    value={raw}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [key]: e.target.value }))
                    }
                    className={`w-20 h-11 rounded-xl bg-ink-800 border px-3 text-right text-base tabular-nums focus:outline-none ${
                      invalid
                        ? 'border-crimson-bright'
                        : 'border-ink-700 focus:border-amber-glow/60'
                    }`}
                  />
                  <span className="text-sm text-ink-500">%</span>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {error && (
        <div className="mt-3 text-sm text-crimson-bright">{error}</div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="min-h-[44px] rounded-2xl bg-ink-800 border border-ink-700 text-sm font-semibold text-ink-200 active:bg-ink-700 disabled:opacity-50"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="min-h-[44px] rounded-2xl bg-amber-glow text-ink-950 text-sm font-bold active:opacity-80 disabled:opacity-40 disabled:bg-ink-700 disabled:text-ink-400"
        >
          {saving ? 'Saving…' : savedRecently ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function toInputs(w: ScoringWeights): Record<FieldKey, string> {
  return {
    rt: String(w.rt),
    imdb: String(w.imdb),
    csm: String(w.csm),
    studio: String(w.studio),
    awards: String(w.awards),
    director: String(w.director),
    writer: String(w.writer),
  };
}

function parseDraft(d: Record<FieldKey, string>): ScoringWeights {
  const toNum = (s: string) => {
    if (s.trim() === '') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  return {
    rt: toNum(d.rt),
    imdb: toNum(d.imdb),
    csm: toNum(d.csm),
    studio: toNum(d.studio),
    awards: toNum(d.awards),
    director: toNum(d.director),
    writer: toNum(d.writer),
  };
}

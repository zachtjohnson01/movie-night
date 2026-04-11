import { useState } from 'react';
import type { Movie } from '../types';
import { ageBadgeClass, formatDate, todayIso } from '../format';
import ExportSheet from './ExportSheet';

type Props = {
  movie: Movie;
  allMovies: Movie[];
  onBack: () => void;
  onUpdate: (updated: Movie) => void;
};

export default function Detail({ movie, allMovies, onBack, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Movie>(movie);
  const [showExport, setShowExport] = useState(false);
  // Snapshot of the list exported on Save. Kept separate so the export sheet
  // reflects the version that was just committed, not any later edits.
  const [exportList, setExportList] = useState<Movie[] | null>(null);

  const isWatched = !!movie.dateWatched;

  function startEdit() {
    setDraft(movie);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(movie);
  }

  function commit(updated: Movie) {
    onUpdate(updated);
    const nextList = allMovies.map((m) =>
      m.title === movie.title ? updated : m,
    );
    setExportList(nextList);
    setShowExport(true);
  }

  function saveEdit() {
    setEditing(false);
    commit(draft);
  }

  function markWatchedTonight() {
    const updated: Movie = { ...movie, dateWatched: todayIso() };
    commit(updated);
  }

  function saveNotesOnly(notes: string) {
    const updated: Movie = { ...movie, notes: notes || null };
    commit(updated);
  }

  return (
    <div className="min-h-full flex flex-col">
      <header
        className="sticky top-0 z-10 bg-ink-950/90 backdrop-blur border-b border-ink-800/70"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2 px-2 py-2">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1 px-2 rounded-xl active:bg-ink-800 text-ink-200"
            aria-label="Back"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span className="text-base font-medium">Back</span>
          </button>
          {!editing ? (
            <button
              type="button"
              onClick={startEdit}
              className="min-h-[44px] px-4 rounded-xl text-amber-glow font-semibold active:bg-ink-800"
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={cancelEdit}
                className="min-h-[44px] px-3 rounded-xl text-ink-300 active:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="min-h-[44px] px-4 rounded-xl bg-amber-glow text-ink-950 font-semibold active:opacity-80"
              >
                Save
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl w-full px-5 pt-4 pb-28 flex-1">
        {editing ? (
          <EditForm draft={draft} onChange={setDraft} />
        ) : (
          <ViewMode
            movie={movie}
            isWatched={isWatched}
            onMarkWatched={markWatchedTonight}
            onSaveNotes={saveNotesOnly}
          />
        )}
      </main>

      {showExport && exportList && (
        <ExportSheet
          movies={exportList}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

function ViewMode({
  movie,
  isWatched,
  onMarkWatched,
  onSaveNotes,
}: {
  movie: Movie;
  isWatched: boolean;
  onMarkWatched: () => void;
  onSaveNotes: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(movie.notes ?? '');
  const notesDirty = (movie.notes ?? '') !== notes;

  return (
    <>
      <h1 className="text-3xl font-bold leading-tight tracking-tight">
        {movie.title}
      </h1>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="CSM Age" value={movie.commonSenseAge} accent="age" />
        <Stat label="RT" value={movie.rottenTomatoes} />
        <Stat label="IMDb" value={movie.imdb} />
      </div>

      {isWatched ? (
        <section className="mt-8">
          <div className="text-xs uppercase tracking-[0.2em] text-ink-500 font-semibold">
            Watched
          </div>
          <div className="mt-1 text-lg text-ink-100 font-semibold">
            {formatDate(movie.dateWatched)}
          </div>

          <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-ink-500 font-semibold">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Favorite scenes, reactions, the moment she gasped…"
            rows={6}
            className="mt-2 w-full rounded-2xl bg-ink-800 border border-ink-700 p-4 text-base leading-relaxed placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
          />
          <button
            type="button"
            disabled={!notesDirty}
            onClick={() => onSaveNotes(notes)}
            className="mt-3 w-full min-h-[52px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80 disabled:opacity-40 disabled:active:opacity-40"
          >
            Save notes
          </button>
        </section>
      ) : (
        <section className="mt-10">
          <button
            type="button"
            onClick={onMarkWatched}
            className="w-full min-h-[60px] rounded-2xl bg-crimson-deep text-white text-lg font-semibold tracking-wide shadow-lg shadow-crimson-deep/20 active:bg-crimson-bright active:opacity-95"
          >
            Mark as watched tonight
          </button>
          <p className="mt-3 text-center text-xs text-ink-500">
            Sets the date to today ({formatDate(todayIso())}).
          </p>
        </section>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null;
  accent?: 'age';
}) {
  const pillClass =
    accent === 'age' && value
      ? ageBadgeClass(value)
      : 'bg-ink-800 border-ink-700 text-ink-100';
  return (
    <div className="rounded-2xl bg-ink-900/70 border border-ink-800 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
        {label}
      </div>
      <div className="mt-2">
        {value ? (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums ${pillClass}`}
          >
            {value}
          </span>
        ) : (
          <span className="text-ink-600 text-sm">—</span>
        )}
      </div>
    </div>
  );
}

function EditForm({
  draft,
  onChange,
}: {
  draft: Movie;
  onChange: (m: Movie) => void;
}) {
  function update<K extends keyof Movie>(key: K, value: Movie[K]) {
    onChange({ ...draft, [key]: value });
  }

  // Treat blank strings as null for optional fields.
  function updateStr(key: keyof Movie, raw: string) {
    const v = raw.trim() === '' ? null : raw;
    onChange({ ...draft, [key]: v } as Movie);
  }

  return (
    <div className="space-y-5">
      <Field label="Title">
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update('title', e.target.value)}
          className={inputClass}
          autoCorrect="off"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="CSM Age">
          <input
            type="text"
            inputMode="text"
            placeholder="6+"
            value={draft.commonSenseAge ?? ''}
            onChange={(e) => updateStr('commonSenseAge', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="RT">
          <input
            type="text"
            placeholder="97%"
            value={draft.rottenTomatoes ?? ''}
            onChange={(e) => updateStr('rottenTomatoes', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="IMDb">
          <input
            type="text"
            placeholder="7.9"
            value={draft.imdb ?? ''}
            onChange={(e) => updateStr('imdb', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Date watched (YYYY-MM-DD)">
        <input
          type="date"
          value={draft.dateWatched ?? ''}
          onChange={(e) => updateStr('dateWatched', e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Notes">
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => updateStr('notes', e.target.value)}
          rows={6}
          className={`${inputClass} leading-relaxed`}
          placeholder="Favorite scenes, reactions, the moment she gasped…"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-500 font-semibold mb-2">
        {label}
      </div>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-2xl bg-ink-800 border border-ink-700 px-4 py-3 text-base focus:outline-none focus:border-amber-glow/60';

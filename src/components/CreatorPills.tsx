import { useState } from 'react';
import { parseNameList } from '../format';

/**
 * Render a list of creator names (directors or writers) as rounded-full
 * pills. Used on the Detail view, Detail edit form, and PoolAdmin edit
 * sheet so directors/writers stay visually separate instead of
 * collapsing into a single comma-joined string.
 *
 * Read-only mode: renders pills only; falls back to an em dash when
 * the list is null/empty.
 *
 * Editable mode: each pill has a × remove button, and a text input
 * below lets the user type a single name or a comma-separated list.
 * Enter or typing a comma commits the pending text as pills. Duplicates
 * (case-insensitive) are skipped so the × button is always unambiguous.
 */
type Props =
  | {
      readOnly: true;
      names: string[] | null;
    }
  | {
      readOnly?: false;
      names: string[] | null;
      onChange: (next: string[] | null) => void;
      placeholder?: string;
    };

const PILL_CLASS =
  'inline-flex items-center rounded-full border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs font-semibold text-ink-200';

export default function CreatorPills(props: Props) {
  if (props.readOnly) {
    if (!props.names || props.names.length === 0) {
      return <span className="text-ink-600 italic text-sm">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {props.names.map((name) => (
          <span key={name} className={PILL_CLASS}>
            {name}
          </span>
        ))}
      </div>
    );
  }

  return <EditablePills {...props} />;
}

function EditablePills({
  names,
  onChange,
  placeholder = 'Add name (comma-separates multiple)',
}: {
  names: string[] | null;
  onChange: (next: string[] | null) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const current = names ?? [];

  function commit(raw: string) {
    const parsed = parseNameList(raw);
    if (!parsed) return;
    const existingLower = new Set(current.map((n) => n.toLowerCase()));
    const additions = parsed.filter(
      (n) => !existingLower.has(n.toLowerCase()),
    );
    if (additions.length === 0) return;
    const next = [...current, ...additions];
    onChange(next.length > 0 ? next : null);
  }

  function flush() {
    if (!input.trim()) return;
    commit(input);
    setInput('');
  }

  function removeAt(index: number) {
    const next = current.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : null);
  }

  function handleChange(value: string) {
    // Typing a comma commits the name(s) typed so far — gives the user
    // live pill-creation without forcing them to blur or hit Enter.
    if (value.endsWith(',')) {
      commit(value);
      setInput('');
      return;
    }
    setInput(value);
  }

  return (
    <div className="flex flex-col gap-2">
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {current.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-800 pl-2.5 pr-1 py-1 text-xs font-semibold text-ink-200"
            >
              {name}
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${name}`}
                className="w-6 h-6 -mr-0.5 flex items-center justify-center rounded-full text-ink-400 active:bg-ink-700 active:text-ink-100"
              >
                <svg
                  viewBox="0 0 24 24"
                  width={12}
                  height={12}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6l-12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            flush();
          }
        }}
        placeholder={placeholder}
        autoCorrect="off"
        className="w-full h-11 rounded-xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
      />
    </div>
  );
}

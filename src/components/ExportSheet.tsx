import { useEffect, useMemo, useState } from 'react';
import type { Movie } from '../types';

type Props = {
  movies: Movie[];
  onClose: () => void;
};

/**
 * Bottom sheet that shows the updated movies.json, with buttons to download
 * it as a file and copy it to the clipboard. This is the "commit flow" —
 * the user pastes the JSON into GitHub and commits the change themselves.
 */
export default function ExportSheet({ movies, onClose }: Props) {
  const json = useMemo(() => JSON.stringify(movies, null, 2) + '\n', [movies]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Auto-copy to clipboard when the sheet opens (per spec: "downloadable file
  // AND copies it to clipboard").
  useEffect(() => {
    copyToClipboard(json).then((ok) => {
      if (ok) setCopied(true);
      else setCopyError('Tap “Copy JSON” to copy manually.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function download() {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'movies.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy() {
    const ok = await copyToClipboard(json);
    if (ok) {
      setCopied(true);
      setCopyError(null);
    } else {
      setCopyError('Clipboard unavailable in this browser.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-ink-900 border-t border-ink-800 rounded-t-3xl shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2">
          <div className="w-10 h-1.5 rounded-full bg-ink-700" />
        </div>

        <div className="px-5 pt-4 pb-5">
          <h2 className="text-xl font-bold">Saved locally</h2>
          <p className="mt-1 text-sm text-ink-400 leading-relaxed">
            {copied
              ? 'The updated movies.json is on your clipboard. '
              : copyError
                ? `${copyError} `
                : 'Preparing your updated movies.json… '}
            Paste it into <span className="text-ink-200">movies.json</span> on
            GitHub and commit.
          </p>

          <pre className="mt-4 max-h-48 overflow-auto rounded-2xl bg-ink-950 border border-ink-800 p-3 text-[11px] leading-relaxed text-ink-300 font-mono">
            {json.slice(0, 1200)}
            {json.length > 1200 ? '\n… (truncated preview) …' : ''}
          </pre>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={copy}
              className="min-h-[52px] rounded-2xl bg-ink-800 border border-ink-700 font-semibold active:bg-ink-700"
            >
              {copied ? 'Copied ✓' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={download}
              className="min-h-[52px] rounded-2xl bg-amber-glow text-ink-950 font-semibold active:opacity-80"
            >
              Download file
            </button>
          </div>

          <ol className="mt-5 space-y-1.5 text-xs text-ink-400 leading-relaxed list-decimal list-inside">
            <li>Open the repo on GitHub mobile.</li>
            <li>Edit <span className="text-ink-200">movies.json</span>.</li>
            <li>Select all, paste, commit to main.</li>
          </ol>

          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full min-h-[48px] rounded-2xl text-ink-300 active:bg-ink-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  // Fallback: textarea + execCommand.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

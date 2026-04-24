import { useState } from 'react';
import type { ShareData } from '../format';

/**
 * Fetch the movie poster through the same-origin `/api/poster` proxy
 * and wrap it in a `File` so `navigator.share({ files })` can attach
 * the image directly. Direct cross-origin fetch from the browser to
 * m.media-amazon.com is blocked by CORS, so the proxy is required.
 * Returns null on any failure — callers fall back to a URL-only share.
 */
async function fetchPosterAsFile(posterUrl: string): Promise<File | null> {
  try {
    const proxyUrl = `/api/poster?url=${encodeURIComponent(posterUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `poster.${ext}`, {
      type: blob.type || 'image/jpeg',
    });
  } catch {
    return null;
  }
}

/**
 * Shared click behaviour for Share buttons. Invokes `navigator.share()`
 * when the Web Share API is available (iOS Safari + installed PWA),
 * falls back to copying the deep link to the clipboard and flashing a
 * transient `copied` state for confirmation. AbortError/NotAllowedError
 * are swallowed (user cancelled the share sheet).
 *
 * When a poster is available and the platform supports file sharing,
 * the image is attached directly so iMessage etc. show the real poster
 * even when the server-side `/api/share` unfurl is unavailable.
 */
export function useShareAction(data: ShareData): {
  onClick: () => Promise<void>;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function onClick() {
    if (canNativeShare) {
      // Try attaching the poster as a file first so the recipient sees
      // the actual movie artwork without relying on iMessage unfurling
      // the URL server-side. Inline the URL into `text` so the deep
      // link is still tappable.
      if (data.posterUrl) {
        const file = await fetchPosterAsFile(data.posterUrl);
        if (
          file &&
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [file] })
        ) {
          try {
            await navigator.share({
              title: data.title,
              text: `${data.text}\n\n${data.url}`,
              files: [file],
            });
            return;
          } catch (err) {
            const name = (err as { name?: string } | null)?.name;
            if (name === 'AbortError' || name === 'NotAllowedError') return;
            // File-share rejected at the OS level — fall through to URL.
            console.warn('file share failed, retrying with URL only', err);
          }
        }
      }
      try {
        await navigator.share({
          title: data.title,
          text: data.text,
          url: data.url,
        });
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'AbortError' || name === 'NotAllowedError') return;
        console.warn('share failed', err);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.warn('clipboard copy failed', err);
    }
  }

  return { onClick, copied };
}

type Props = {
  data: ShareData;
  className?: string;
};

/**
 * 44x44 icon button styled for the classic Tailwind Detail header.
 * For the modern design's round hero button, use `useShareAction`
 * directly and render your own button.
 */
export default function ShareButton({ data, className }: Props) {
  const { onClick, copied } = useShareAction(data);

  const base =
    'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl active:bg-ink-800 text-ink-200';
  const cls = className ? `${base} ${className}` : base;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cls}
      aria-label={copied ? 'Link copied' : 'Share'}
    >
      {copied ? <CheckIcon /> : <ShareIcon />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Link copied' : ''}
      </span>
    </button>
  );
}

export function ShareIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3v13" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

export function CheckIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

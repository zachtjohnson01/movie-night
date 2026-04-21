import { useState } from 'react';
import type { Movie } from '../../types';
import { getDisplayTitle } from '../../format';
import { posterFor } from './palette';

type Props = {
  movie: Pick<Movie, 'title' | 'displayTitle' | 'poster'>;
  size: number;
  radius?: number;
};

/*
 * Poster tile sized in pixels (the design uses 54/68/92/96/108/110 and the
 * existing MoviePoster component only supports two fixed sizes). The base
 * layer is always a painted gradient placeholder derived from the title — if
 * the movie has a real poster URL, an <img> is layered on top and fades in
 * once it loads. A failed image load just reveals the placeholder.
 */
export default function ModernPoster({ movie, size, radius = 8 }: Props) {
  const [imgOk, setImgOk] = useState(false);
  const { c1, c2, accent, ink } = posterFor(movie.title);
  const h = Math.round(size * 1.5);
  const title = getDisplayTitle(movie);
  const letter = title.trim().charAt(0).toUpperCase() || '?';
  const fontSize = Math.max(10, Math.min(22, Math.floor(size / 5)));

  return (
    <div
      style={{
        width: size,
        height: h,
        borderRadius: radius,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        background: c2,
        boxShadow: '0 2px 4px rgba(0,0,0,0.2), 0 10px 24px rgba(0,0,0,0.25)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${c1} 0%, ${c2} 100%)`,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -size * 0.25,
          top: h * 0.1,
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: '999px',
          background: accent,
          opacity: 0.55,
          filter: 'blur(2px)',
        }}
      />
      {!imgOk && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            padding: `0 ${Math.round(size * 0.08)}px ${Math.round(h * 0.08)}px`,
            background: `linear-gradient(to top, ${c1}dd, transparent 55%)`,
            color: ink,
            fontFamily: '"Archivo Black", Impact, "Helvetica Neue", sans-serif',
            fontWeight: 900,
            fontSize,
            letterSpacing: -0.3,
            lineHeight: 1,
            textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            wordBreak: 'break-word',
          }}
        >
          {letter}
        </div>
      )}
      {movie.poster && (
        <img
          src={movie.poster}
          alt=""
          loading="lazy"
          onLoad={(e) => {
            if ((e.currentTarget as HTMLImageElement).naturalWidth > 0) {
              setImgOk(true);
            }
          }}
          onError={() => setImgOk(false)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: imgOk ? 1 : 0,
            transition: 'opacity 240ms ease-out',
          }}
        />
      )}
    </div>
  );
}

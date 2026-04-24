import { useLayoutEffect, useState } from 'react';
import type { Movie } from '../../types';
import {
  buildShareData,
  formatDate,
  getDisplayTitle,
  todayIso,
} from '../../format';
import { commonSenseUrl } from '../../omdb';
import { CheckIcon, ShareIcon, useShareAction } from '../ShareButton';
import {
  AMBER,
  BG,
  BG_3,
  BORDER,
  CRIMSON,
  DISPLAY,
  INK,
  INK_2,
  INK_3,
  SANS,
  ageTone,
  formatDateLong,
  posterFor,
} from './palette';
import ModernPoster from './ModernPoster';
import ClassicDetail from '../Detail';

/*
 * Same prop surface as the classic Detail component so App.tsx can swap
 * them interchangeably. For 'new' mode (blank template) we defer to the
 * classic Detail — the modern hero doesn't apply to an empty movie, and
 * the new-movie add flow already has a polished classic form. For existing
 * movies we render a gradient hero + chip stats + core actions, and expose
 * an "Edit details" entry point that swaps in the classic Detail when the
 * user needs the full edit / OMDB link / refresh surface.
 */
type Props =
  | {
      mode: 'existing';
      canWrite: boolean;
      isOwner?: boolean;
      movie: Movie;
      onBack: () => void;
      onUpdate: (updated: Movie) => void | Promise<void>;
      onDelete: (movie: Movie) => void | Promise<void>;
    }
  | {
      mode: 'new';
      canWrite: boolean;
      movie: Movie;
      onBack: () => void;
      onCreate: (created: Movie) => void | Promise<void>;
    }
  | {
      mode: 'candidate';
      canWrite: boolean;
      movie: Movie;
      onBack: () => void;
      onAddToWishlist: (movie: Movie) => void | Promise<void>;
      onMarkWatchedTonight: (movie: Movie) => void | Promise<void>;
      onMarkWatchedUndated: (movie: Movie) => void | Promise<void>;
    };

export default function ModernDetail(props: Props) {
  const [showClassic, setShowClassic] = useState(false);

  if (props.mode === 'new' || props.mode === 'candidate') {
    return <ClassicDetail {...props} />;
  }

  if (showClassic) {
    return (
      <ClassicDetail
        mode="existing"
        canWrite={props.canWrite}
        isOwner={props.isOwner}
        movie={props.movie}
        onBack={() => setShowClassic(false)}
        onUpdate={props.onUpdate}
        onDelete={props.onDelete}
      />
    );
  }

  return (
    <ModernView
      movie={props.movie}
      canWrite={props.canWrite}
      onBack={props.onBack}
      onUpdate={props.onUpdate}
      onDelete={props.onDelete}
      onEditDetails={() => setShowClassic(true)}
    />
  );
}

function ModernView({
  movie,
  canWrite,
  onBack,
  onUpdate,
  onDelete,
  onEditDetails,
}: {
  movie: Movie;
  canWrite: boolean;
  onBack: () => void;
  onUpdate: (updated: Movie) => void | Promise<void>;
  onDelete: (movie: Movie) => void | Promise<void>;
  onEditDetails: () => void;
}) {
  const { c1, c2, accent } = posterFor(movie.title);
  const age = ageTone(movie.commonSenseAge);
  const [notes, setNotes] = useState(movie.notes ?? '');
  const notesDirty = (movie.notes ?? '') !== notes;
  const share = useShareAction(
    buildShareData(movie, typeof window !== 'undefined' ? window.location.origin : ''),
  );

  // Detail screens are deep-link destinations — scroll to top on mount so
  // the gradient hero actually appears first. Matches the behaviour of the
  // classic Detail component.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
    }
  }, []);

  const eyebrow = movie.watched
    ? movie.dateWatched
      ? formatDateLong(movie.dateWatched)
      : 'Watched · date unknown'
    : 'On the wishlist';

  async function markWatchedTonight() {
    await onUpdate({ ...movie, watched: true, dateWatched: todayIso() });
  }
  async function saveNotes() {
    await onUpdate({ ...movie, notes: notes || null });
  }
  async function handleDelete() {
    const prompt = movie.watched
      ? `Delete "${getDisplayTitle(movie)}"? This can't be undone.`
      : `Remove "${getDisplayTitle(movie)}" from your wishlist?`;
    if (!confirm(prompt)) return;
    await onDelete(movie);
  }

  return (
    <div
      style={{
        background: BG,
        minHeight: '100%',
        color: INK,
        fontFamily: SANS,
        paddingBottom: 60,
      }}
    >
      {/* Gradient hero */}
      <div
        style={{
          position: 'relative',
          height: 260,
          background: `linear-gradient(180deg, ${c1} 0%, ${c2} 65%, ${BG} 100%)`,
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, opacity: 0.3 }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 400 260"
            preserveAspectRatio="xMidYMid slice"
          >
            <circle cx="330" cy="80" r="75" fill={accent} opacity="0.6" />
            <circle cx="60" cy="200" r="105" fill={accent} opacity="0.35" />
          </svg>
        </div>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 12px)',
            left: 16,
            zIndex: 2,
            width: 38,
            height: 38,
            minWidth: 44,
            minHeight: 44,
            borderRadius: 999,
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <svg width="11" height="18" viewBox="0 0 12 20" fill="none">
            <path
              d="M10 2L2 10l8 8"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={share.onClick}
          aria-label={share.copied ? 'Link copied' : 'Share'}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 12px)',
            right: 16,
            zIndex: 2,
            width: 38,
            height: 38,
            minWidth: 44,
            minHeight: 44,
            borderRadius: 999,
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
          }}
        >
          {share.copied ? (
            <CheckIcon className="w-5 h-5" />
          ) : (
            <ShareIcon className="w-5 h-5" />
          )}
          <span className="sr-only" aria-live="polite">
            {share.copied ? 'Link copied' : ''}
          </span>
        </button>
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 20,
            right: 20,
            display: 'flex',
            gap: 16,
            alignItems: 'flex-end',
          }}
        >
          <ModernPoster movie={movie} size={110} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: SANS,
                fontSize: 11,
                color: 'rgba(255,255,255,0.75)',
                letterSpacing: 2,
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {eyebrow}
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 34,
                color: '#fff',
                fontWeight: 500,
                letterSpacing: -1,
                lineHeight: 0.95,
                marginTop: 6,
                textShadow: '0 2px 12px rgba(0,0,0,0.5)',
              }}
            >
              {getDisplayTitle(movie)}
            </div>
            {movie.year && (
              <div
                style={{
                  marginTop: 6,
                  fontFamily: SANS,
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.7)',
                  fontWeight: 500,
                }}
              >
                {movie.year}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chip stats */}
      <div style={{ padding: '24px 20px 0' }}>
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          }}
        >
          <a
            href={commonSenseUrl(movie)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: age.bg,
              border: `1px solid ${age.border}`,
              textDecoration: 'none',
              display: 'block',
            }}
          >
            <div
              style={{
                fontFamily: SANS,
                fontSize: 10,
                color: INK_3,
                letterSpacing: 1,
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              CSM Age
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 22,
                color: age.fg,
                fontWeight: 600,
                marginTop: 2,
                letterSpacing: -0.3,
              }}
            >
              {movie.commonSenseAge || '—'}
            </div>
          </a>
          <ChipStat label="Rotten T." value={movie.rottenTomatoes || '—'} />
          <ChipStat label="IMDb" value={movie.imdb || '—'} />
        </div>
      </div>

      {/* Studio / awards block */}
      {(movie.production || movie.awards) && (
        <div style={{ padding: '18px 20px 0' }}>
          <div
            style={{
              background: BG_3,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {movie.production && (
              <div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 10,
                    color: INK_3,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  Studio
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 14,
                    color: INK,
                    marginTop: 2,
                  }}
                >
                  {movie.production}
                </div>
              </div>
            )}
            {movie.awards && (
              <div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 10,
                    color: INK_3,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  Awards
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: AMBER,
                    marginTop: 2,
                    lineHeight: 1.4,
                  }}
                >
                  {movie.awards}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Directors / Writers */}
      {((movie.directors && movie.directors.length > 0) ||
        (movie.writers && movie.writers.length > 0)) && (
        <div style={{ padding: '18px 20px 0' }}>
          <div
            style={{
              background: BG_3,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {movie.directors && movie.directors.length > 0 && (
              <ModernPillRow
                label={movie.directors.length > 1 ? 'Directors' : 'Director'}
                names={movie.directors}
              />
            )}
            {movie.writers && movie.writers.length > 0 && (
              <ModernPillRow
                label={movie.writers.length > 1 ? 'Writers' : 'Writer'}
                names={movie.writers}
              />
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      {movie.watched && (movie.notes || canWrite) && (
        <div style={{ padding: '22px 20px 0' }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: INK_3,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Note from the night
          </div>
          {canWrite ? (
            <>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder="Favorite scenes, reactions, the moment she gasped…"
                style={{
                  marginTop: 8,
                  width: '100%',
                  borderRadius: 14,
                  background: BG_3,
                  border: `1px solid ${BORDER}`,
                  padding: 14,
                  color: INK,
                  fontFamily: DISPLAY,
                  fontStyle: 'italic',
                  fontSize: 17,
                  lineHeight: 1.45,
                  letterSpacing: -0.1,
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
              <button
                type="button"
                disabled={!notesDirty}
                onClick={() => void saveNotes()}
                style={{
                  marginTop: 10,
                  width: '100%',
                  minHeight: 48,
                  borderRadius: 12,
                  background: notesDirty ? AMBER : BG_3,
                  color: notesDirty ? '#1a1a1a' : INK_3,
                  border: notesDirty ? 'none' : `1px solid ${BORDER}`,
                  fontFamily: SANS,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: notesDirty ? 'pointer' : 'default',
                }}
              >
                Save notes
              </button>
            </>
          ) : movie.notes ? (
            <div
              style={{
                fontFamily: DISPLAY,
                fontStyle: 'italic',
                fontSize: 18,
                color: INK,
                lineHeight: 1.45,
                marginTop: 6,
                letterSpacing: -0.2,
              }}
            >
              “{movie.notes}”
            </div>
          ) : null}
        </div>
      )}

      {/* Primary action */}
      {canWrite && (
        <div
          style={{
            padding: '28px 20px 0',
            display: 'flex',
            gap: 10,
          }}
        >
          <button
            type="button"
            disabled={movie.watched}
            onClick={() => void markWatchedTonight()}
            style={{
              flex: 1,
              minHeight: 52,
              borderRadius: 14,
              background: movie.watched ? BG_3 : CRIMSON,
              color: movie.watched ? INK_2 : '#fff',
              border: movie.watched ? `1px solid ${BORDER}` : 'none',
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: 700,
              cursor: movie.watched ? 'default' : 'pointer',
            }}
          >
            {movie.watched
              ? movie.dateWatched
                ? `Watched ${formatDate(movie.dateWatched)}`
                : 'Already watched'
              : 'Mark watched tonight'}
          </button>
          <button
            type="button"
            onClick={onEditDetails}
            aria-label="Edit details"
            style={{
              minHeight: 52,
              minWidth: 52,
              width: 52,
              borderRadius: 14,
              background: BG_3,
              color: INK,
              border: `1px solid ${BORDER}`,
              fontSize: 20,
              cursor: 'pointer',
            }}
          >
            ⋯
          </button>
        </div>
      )}

      {canWrite && (
        <div style={{ padding: '28px 20px 0' }}>
          <button
            type="button"
            onClick={() => void handleDelete()}
            style={{
              width: '100%',
              minHeight: 48,
              borderRadius: 12,
              background: 'transparent',
              border: 'none',
              color: '#fda4af',
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {movie.watched ? 'Delete movie' : 'Remove from wishlist'}
          </button>
        </div>
      )}
    </div>
  );
}

function ModernPillRow({
  label,
  names,
}: {
  label: string;
  names: string[];
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 10,
          color: INK_3,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        {names.map((n) => (
          <span
            key={n}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 10px',
              borderRadius: 999,
              background: BG,
              border: `1px solid ${BORDER}`,
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              color: INK_2,
            }}
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChipStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 12,
        background: BG_3,
        border: `1px solid ${BORDER}`,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 10,
          color: INK_3,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 22,
          color: INK,
          fontWeight: 500,
          marginTop: 2,
          letterSpacing: -0.3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

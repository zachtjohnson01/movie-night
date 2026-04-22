import { useCallback, useMemo, useState } from 'react';
import type { Candidate, Movie } from '../../types';
import type { CandidatePoolApi } from '../../useCandidatePool';
import {
  expandPool,
  rankTopPicks,
  type RankedPick,
} from '../../recommendations';
import {
  AMBER,
  BG,
  BG_2,
  BG_3,
  BORDER,
  CRIMSON,
  DISPLAY,
  INK,
  INK_2,
  INK_3,
  MONO,
  SANS,
  ageTone,
} from './palette';
import ModernPoster from './ModernPoster';

type Props = {
  movies: Movie[];
  pool: CandidatePoolApi;
  canWrite: boolean;
  onSelectPick: (c: Candidate) => void;
};

const TOP_N = 20;
const EXPAND_BATCH = 100;
const SEED_BATCHES = 5;

export default function ModernRecommendations({
  movies,
  pool,
  canWrite,
  onSelectPick,
}: Props) {
  const [busy, setBusy] = useState<
    | { kind: 'idle' }
    | { kind: 'seeding'; done: number; total: number; added: number }
    | { kind: 'expanding' }
  >({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const picks = useMemo(
    () => rankTopPicks(pool.candidates, movies, TOP_N),
    [pool.candidates, movies],
  );
  const libraryTitles = useMemo(() => movies.map((m) => m.title), [movies]);
  const watchedCount = useMemo(
    () => movies.filter((m) => m.watched).length,
    [movies],
  );

  const runExpansion = useCallback(
    async (batches: number) => {
      setError(null);
      let added = 0;
      const currentPoolTitles = () => pool.candidates.map((c) => c.title);
      for (let i = 0; i < batches; i++) {
        if (batches > 1) {
          setBusy({ kind: 'seeding', done: i, total: batches, added });
        } else {
          setBusy({ kind: 'expanding' });
        }
        try {
          const fresh = await expandPool(
            [...currentPoolTitles()],
            libraryTitles,
            EXPAND_BATCH,
          );
          if (fresh.length === 0) break;
          await pool.appendCandidates(fresh);
          added += fresh.length;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          break;
        }
      }
      setBusy({ kind: 'idle' });
    },
    [libraryTitles, pool],
  );

  const loading = pool.status === 'loading';
  const poolEmpty = pool.status === 'empty';
  const poolErrored = pool.status === 'error';
  const seeding = busy.kind === 'seeding';
  const expanding = busy.kind === 'expanding';
  const anyBusy = seeding || expanding;

  return (
    <div
      style={{
        background: BG,
        minHeight: '100%',
        color: INK,
        fontFamily: SANS,
        paddingBottom: 140,
      }}
    >
      <style>{`
        @keyframes mm-spin { to { transform: rotate(360deg); } }
        @keyframes mm-shim {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>

      <div
        style={{
          padding: 'calc(env(safe-area-inset-top) + 40px) 20px 0',
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 11,
            color: INK_3,
            letterSpacing: 2,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          For you
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 40,
            color: INK,
            fontWeight: 400,
            marginTop: 10,
            letterSpacing: -1.2,
            lineHeight: 1,
          }}
        >
          <span style={{ fontStyle: 'italic' }}>Ranked</span> for
          <br />
          <span
            style={{
              color: INK_2,
              fontStyle: 'italic',
              fontWeight: 300,
            }}
          >
            your {watchedCount} nights.
          </span>
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 12,
            color: INK_3,
            marginTop: 12,
          }}
        >
          {loading ? (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Spinner size={10} />
              Loading candidate pool…
            </span>
          ) : (
            <span>
              {picks.length} {picks.length === 1 ? 'pick' : 'picks'}, best
              first · ranked by RT+IMDb, then CSM age, studio, awards
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {loading && (
          <>
            <RecSkeleton />
            <RecSkeleton />
            <RecSkeleton />
            <RecSkeleton />
          </>
        )}

        {poolErrored && (
          <div
            style={{
              margin: '20px',
              padding: '18px',
              background: BG_2,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              fontFamily: SANS,
              fontSize: 13,
              color: INK_2,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, color: INK, marginBottom: 6 }}>
              Couldn't load the candidate pool
            </div>
            <div style={{ color: INK_3, fontSize: 12, marginBottom: 12 }}>
              Something went wrong reading from Supabase. Check your
              connection and try again.
            </div>
            <button
              type="button"
              onClick={pool.reload}
              style={primaryButtonStyle(false)}
            >
              Try again
            </button>
          </div>
        )}

        {poolEmpty && !loading && !seeding && (
          <div
            style={{
              margin: '20px',
              padding: '18px',
              background: BG_2,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              fontFamily: SANS,
              fontSize: 13,
              color: INK_2,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, color: INK, marginBottom: 6 }}>
              No candidate pool yet
            </div>
            <div style={{ color: INK_3, fontSize: 12, marginBottom: 12 }}>
              Seed a pool of ~{EXPAND_BATCH * SEED_BATCHES} family films to
              rank against. Each film is enriched with authoritative scores
              from OMDB. This takes a couple minutes.
            </div>
            {canWrite ? (
              <button
                type="button"
                onClick={() => void runExpansion(SEED_BATCHES)}
                style={primaryButtonStyle(false)}
              >
                Seed candidate pool
              </button>
            ) : (
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  color: INK_3,
                  fontStyle: 'italic',
                }}
              >
                Sign in as an allowed user to seed the pool.
              </div>
            )}
            {error && (
              <div
                style={{
                  marginTop: 12,
                  fontFamily: SANS,
                  fontSize: 11,
                  color: CRIMSON,
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}

        {seeding && (
          <div
            style={{
              margin: '20px',
              padding: '18px',
              background: BG_2,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              fontFamily: SANS,
              fontSize: 13,
              color: INK_2,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <Spinner size={12} />
              <span style={{ fontWeight: 700, color: INK }}>
                Seeding pool… ({busy.done}/{busy.total})
              </span>
            </div>
            <div style={{ color: INK_3, fontSize: 12 }}>
              {busy.added} films added so far. Don't close the tab.
            </div>
          </div>
        )}

        {!poolEmpty && !loading && !poolErrored && (
          <div>
            {picks.map((rec, i) => (
              <RecCard
                key={rec.title}
                rec={rec}
                rank={i + 1}
                onSelect={() => onSelectPick(rec)}
              />
            ))}
            {picks.length === 0 && (
              <div
                style={{
                  padding: '32px 24px',
                  textAlign: 'center',
                  fontFamily: SANS,
                  fontSize: 14,
                  color: INK_3,
                }}
              >
                Every candidate in the pool is already on your list. Expand
                the pool to find new picks.
              </div>
            )}
          </div>
        )}

        {!poolEmpty && !loading && !poolErrored && canWrite && (
          <div
            style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <button
              type="button"
              disabled={anyBusy}
              onClick={() => void runExpansion(1)}
              style={primaryButtonStyle(anyBusy)}
            >
              {expanding ? (
                <>
                  <Spinner size={12} color={INK_3} />
                  Adding {EXPAND_BATCH} more…
                </>
              ) : (
                <>＋ Pool: {pool.candidates.length} · Add {EXPAND_BATCH} more</>
              )}
            </button>
            {error && (
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 11,
                  color: CRIMSON,
                  textAlign: 'center',
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function primaryButtonStyle(busy: boolean): React.CSSProperties {
  return {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    background: busy ? BG_3 : AMBER,
    color: busy ? INK_3 : '#1a1a1a',
    border: busy ? `1px solid ${BORDER}` : 'none',
    fontFamily: SANS,
    fontSize: 14,
    fontWeight: 700,
    cursor: busy ? 'default' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'all 200ms',
  };
}

function RecCard({
  rec,
  rank,
  onSelect,
}: {
  rec: RankedPick;
  rank: number;
  onSelect: () => void;
}) {
  const age = ageTone(rec.commonSenseAge);
  const topRank = rank <= 3;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 20px',
        cursor: 'pointer',
        borderBottom: `1px solid ${BORDER}`,
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderBottomColor: BORDER,
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        textAlign: 'left',
        color: INK,
      }}
    >
      <div
        style={{
          width: 28,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 4,
          gap: 2,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: rank <= 9 ? 28 : 22,
            color: topRank ? AMBER : INK_2,
            fontWeight: topRank ? 600 : 400,
            fontStyle: 'italic',
            lineHeight: 1,
            letterSpacing: -1,
          }}
        >
          {rank}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 9,
            color: INK_3,
            letterSpacing: 0.5,
          }}
        >
          {rec.fitScore}
        </div>
      </div>

      <CandidatePoster rec={rec} />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 15,
              color: INK,
              fontWeight: 600,
              letterSpacing: -0.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {rec.title}
          </div>
          {rec.year && (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: INK_3,
                flexShrink: 0,
              }}
            >
              {rec.year}
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {rec.commonSenseAge && (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 10,
                fontWeight: 700,
                color: age.fg,
                background: age.bg,
                border: `1px solid ${age.border}`,
                padding: '2px 7px',
                borderRadius: 6,
              }}
            >
              {rec.commonSenseAge}
            </span>
          )}
          {rec.rottenTomatoes && (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 11,
                color: INK_2,
                fontWeight: 500,
              }}
            >
              🍅 {rec.rottenTomatoes}
            </span>
          )}
          {rec.imdb && (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 11,
                color: INK_2,
                fontWeight: 500,
              }}
            >
              ★ {rec.imdb}
            </span>
          )}
        </div>
        {(rec.studio || rec.awards) && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 10.5,
              color: INK_3,
              fontWeight: 500,
              letterSpacing: 0.1,
              marginTop: 1,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {rec.studio && <span>{rec.studio}</span>}
            {rec.studio && rec.awards && (
              <span style={{ opacity: 0.5 }}>·</span>
            )}
            {rec.awards && (
              <span style={{ color: AMBER, opacity: 0.85 }}>
                🏆 {rec.awards}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function CandidatePoster({ rec }: { rec: Candidate }) {
  /* Candidate has a poster URL but no displayTitle — synthesize a Movie-shaped
   * object so ModernPoster's fallback placeholder picks up the same
   * title-hashed palette used everywhere else in the modern UI. */
  return (
    <ModernPoster
      movie={{ title: rec.title, displayTitle: null, poster: rec.poster }}
      size={68}
    />
  );
}

function RecSkeleton() {
  const shim = {
    background: `linear-gradient(110deg, ${BG_3} 20%, ${BG_2} 40%, ${BG_3} 60%)`,
    backgroundSize: '300% 100%',
    animation: 'mm-shim 1.4s ease-in-out infinite',
  };
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '14px 20px',
        borderBottom: `1px solid ${BORDER}`,
        opacity: 0.8,
      }}
    >
      <div style={{ width: 76, height: 114, borderRadius: 8, ...shim }} />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          paddingTop: 6,
        }}
      >
        <div style={{ width: '70%', height: 14, borderRadius: 4, ...shim }} />
        <div style={{ width: '45%', height: 10, borderRadius: 4, ...shim }} />
        <div style={{ width: '90%', height: 10, borderRadius: 4, ...shim }} />
        <div style={{ width: '75%', height: 10, borderRadius: 4, ...shim }} />
      </div>
    </div>
  );
}

function Spinner({
  size = 12,
  color = AMBER,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 999,
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        animation: 'mm-spin 0.9s linear infinite',
      }}
    />
  );
}

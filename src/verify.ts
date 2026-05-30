import { supabase } from './supabase';

/**
 * Client wrapper for the owner-only /api/verify endpoint. Sends one movie +
 * one free-form question to Claude and returns a structured suggestion the
 * Detail page can offer as a one-tap update.
 */

export type VerifyField = 'production' | 'awards' | 'year' | 'commonSenseAge' | 'director' | 'writer';

export type VerifyResult = {
  field: VerifyField | null;
  currentValue: string | null;
  suggestedValue: string | null;
  matches: boolean;
  explanation: string;
};

/**
 * The subset of fields the verify endpoint actually reads. Both Movie (Detail
 * page) and Candidate (pool admin) provide these — callers pass whichever they
 * have, mapping `studio → production` for candidates at the call site.
 */
export type VerifyInput = {
  title: string;
  year: number | null;
  imdbId: string | null;
  production: string | null;
  awards: string | null;
  commonSenseAge: string | null;
  directors: string[] | null;
  writers: string[] | null;
};

export async function verifyField(
  movie: VerifyInput,
  question: string,
): Promise<VerifyResult> {
  if (!supabase) {
    throw new Error('Auth is not configured — cannot verify.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Sign in required to verify.');
  }

  const resp = await fetch('/api/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      movie: {
        title: movie.title,
        year: movie.year,
        imdbId: movie.imdbId,
        production: movie.production,
        awards: movie.awards,
        commonSenseAge: movie.commonSenseAge,
        // The /api/verify Claude prompt consumes these as single strings;
        // join the array back with commas on the way out so the server
        // contract stays stable.
        director: movie.directors ? movie.directors.join(', ') : null,
        writer: movie.writers ? movie.writers.join(', ') : null,
      },
      question,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    const base = body.error || `HTTP ${resp.status}`;
    throw new Error(body.detail ? `${base} — ${body.detail}` : base);
  }

  const data = (await resp.json()) as { result?: VerifyResult };
  if (!data.result) {
    throw new Error('Empty response from verification service');
  }
  return data.result;
}

/**
 * Canned question per verifiable field, used by `verifyAll`. The /api/verify
 * endpoint maps a single free-form question to one field, so "verify all data"
 * is just one well-formed question per field. Order is roughly the order the
 * fields appear in the pool edit sheet.
 */
export const VERIFY_ALL_QUESTIONS: { field: VerifyField; question: string }[] = [
  { field: 'year', question: 'What year was this movie originally released?' },
  {
    field: 'commonSenseAge',
    question: "What is Common Sense Media's recommended age rating for this movie?",
  },
  {
    field: 'production',
    question: 'What is the lead production company or studio for this movie?',
  },
  { field: 'director', question: 'Who directed this movie?' },
  { field: 'writer', question: 'Who wrote the screenplay for this movie?' },
  {
    field: 'awards',
    question:
      'Did this movie win or earn nominations for any major awards (Oscars, BAFTAs, Golden Globes, Annie Awards)?',
  },
];

/**
 * Run Claude across every verifiable field for one movie/candidate, returning
 * a result per field. Calls are sequential because each spends Anthropic
 * credits and the endpoint is one-field-per-request. The first call is allowed
 * to throw (it surfaces auth/config errors up front); later per-field failures
 * degrade to a null-field result so one flaky field doesn't abort the rest.
 */
export async function verifyAll(
  input: VerifyInput,
  onProgress?: (done: number, total: number) => void,
): Promise<VerifyResult[]> {
  const total = VERIFY_ALL_QUESTIONS.length;
  const results: VerifyResult[] = [];
  for (let i = 0; i < total; i++) {
    onProgress?.(i, total);
    try {
      results.push(await verifyField(input, VERIFY_ALL_QUESTIONS[i].question));
    } catch (e) {
      if (i === 0) throw e;
      results.push({
        field: null,
        currentValue: null,
        suggestedValue: null,
        matches: false,
        explanation: (e as Error).message || 'Field check failed',
      });
    }
  }
  onProgress?.(total, total);
  return results;
}

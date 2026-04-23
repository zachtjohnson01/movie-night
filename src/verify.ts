import { supabase } from './supabase';
import type { Movie } from './types';

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

export async function verifyField(
  movie: Movie,
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
        director: movie.director,
        writer: movie.writer,
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

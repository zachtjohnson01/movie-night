import { describe, expect, it } from 'vitest';
import { formatRtScore } from './format';

describe('formatRtScore', () => {
  it('appends % to a bare integer', () => {
    expect(formatRtScore('84')).toBe('84%');
  });
  it('rounds a decimal before appending %', () => {
    expect(formatRtScore('84.6')).toBe('85%');
  });
  it('clamps values above 100', () => {
    expect(formatRtScore('840')).toBe('100%');
  });
  it('leaves an already-formatted percent untouched', () => {
    expect(formatRtScore('84%')).toBe('84%');
  });
  it('trims surrounding whitespace', () => {
    expect(formatRtScore('  91  ')).toBe('91%');
  });
  it('collapses blank / null to null', () => {
    expect(formatRtScore('   ')).toBeNull();
    expect(formatRtScore('')).toBeNull();
    expect(formatRtScore(null)).toBeNull();
  });
  it('passes through non-numeric strings unchanged', () => {
    expect(formatRtScore('Fresh')).toBe('Fresh');
  });
});

import { describe, expect, it } from 'vitest';
import { uniqueViolation } from './db-errors';

/** So kommt der Fehler beim Treiber an. */
function pgFehler(constraint?: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

/** … und so, nachdem Drizzle ihn eingepackt hat. */
function eingepackt(inner: unknown) {
  return Object.assign(new Error('Failed query: insert into "download_presets" …'), {
    cause: inner,
  });
}

describe('uniqueViolation', () => {
  it('erkennt den nackten Treiberfehler', () => {
    expect(uniqueViolation(pgFehler('download_presets_name_idx'))).toBe(
      'download_presets_name_idx',
    );
  });

  it('erkennt ihn auch unter der Drizzle-Hülle', () => {
    expect(uniqueViolation(eingepackt(pgFehler('download_presets_name_idx')))).toBe(
      'download_presets_name_idx',
    );
  });

  it('greift auch durch zwei Hüllen', () => {
    expect(uniqueViolation(eingepackt(eingepackt(pgFehler('irgendein_idx'))))).toBe(
      'irgendein_idx',
    );
  });

  it('meldet den Verstoß auch ohne Namen', () => {
    expect(uniqueViolation(eingepackt(pgFehler()))).toBe('');
  });

  it('lässt andere Fehler durch', () => {
    expect(uniqueViolation(new Error('irgendwas'))).toBeNull();
    expect(uniqueViolation(null)).toBeNull();
    expect(uniqueViolation(eingepackt(Object.assign(new Error('x'), { code: '23503' })))).toBeNull();
  });

  it('bleibt bei einer Kette im Kreis stehen', () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(uniqueViolation(a)).toBeNull();
  });
});

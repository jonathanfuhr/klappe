import { describe, expect, it } from 'vitest';
import { createUnsubscribeToken, readUnsubscribeToken } from './unsubscribe-token';

const SECRET = 'test-secret-nur-fuer-den-pruflauf-0123456789';
const USER = '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';

describe('Abmelde-Token', () => {
  it('liest die Benutzer-ID wieder aus', () => {
    expect(readUnsubscribeToken(createUnsubscribeToken(USER, SECRET), SECRET)).toBe(USER);
  });

  it('weist eine fremde Signatur ab', () => {
    const fremd = createUnsubscribeToken(USER, 'anderes-secret');
    expect(readUnsubscribeToken(fremd, SECRET)).toBeNull();
  });

  it('lässt sich nicht auf eine andere Benutzer-ID umbiegen', () => {
    const token = createUnsubscribeToken(USER, SECRET);
    const signatur = token.split('.').pop() ?? '';
    expect(readUnsubscribeToken(`ein-anderer-nutzer.${signatur}`, SECRET)).toBeNull();
  });

  it('verträgt fehlende und kaputte Werte', () => {
    expect(readUnsubscribeToken(undefined, SECRET)).toBeNull();
    expect(readUnsubscribeToken('', SECRET)).toBeNull();
    expect(readUnsubscribeToken('ohne-signatur', SECRET)).toBeNull();
    expect(readUnsubscribeToken('.nur-signatur', SECRET)).toBeNull();
  });

  it('ist für dieselbe ID stabil', () => {
    expect(createUnsubscribeToken(USER, SECRET)).toBe(createUnsubscribeToken(USER, SECRET));
  });
});

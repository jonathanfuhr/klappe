import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret-box';

const SECRET = 'test-secret-nur-fuer-den-pruflauf-0123456789';

describe('encryptSecret / decryptSecret', () => {
  it('gibt den Klartext wieder her', () => {
    const box = encryptSecret('smtp-passwort-2026', SECRET);
    expect(decryptSecret(box, SECRET)).toBe('smtp-passwort-2026');
  });

  it('verrät den Klartext nicht im gespeicherten Wert', () => {
    const box = encryptSecret('smtp-passwort-2026', SECRET);
    expect(box).not.toContain('smtp-passwort-2026');
    expect(box.startsWith('v1.')).toBe(true);
  });

  it('erzeugt jedes Mal einen anderen Wert (zufällige Nonce)', () => {
    expect(encryptSecret('gleich', SECRET)).not.toBe(encryptSecret('gleich', SECRET));
  });

  it('scheitert bei falschem Schlüssel, ohne zu werfen', () => {
    const box = encryptSecret('smtp-passwort-2026', SECRET);
    expect(decryptSecret(box, 'ein-anderes-secret')).toBeNull();
  });

  it('erkennt Manipulation am Geheimtext', () => {
    const parts = encryptSecret('smtp-passwort-2026', SECRET).split('.');
    const veraendert = Buffer.from(parts[2], 'base64url');
    veraendert[0] ^= 0xff;
    parts[2] = veraendert.toString('base64url');
    expect(decryptSecret(parts.join('.'), SECRET)).toBeNull();
  });

  it('behandelt fehlende und kaputte Werte als leer', () => {
    expect(decryptSecret(null, SECRET)).toBeNull();
    expect(decryptSecret('', SECRET)).toBeNull();
    expect(decryptSecret('kein-format', SECRET)).toBeNull();
    expect(decryptSecret('v2.a.b.c', SECRET)).toBeNull();
  });

  it('kommt mit Umlauten und langen Passwörtern klar', () => {
    const lang = `Ümlaute-und-Ärger-${'x'.repeat(500)}`;
    expect(decryptSecret(encryptSecret(lang, SECRET), SECRET)).toBe(lang);
  });
});

import { describe, expect, it } from 'vitest';
import { contentDisposition, normalizeEmail, normalizeName, sanitizeFilename } from './normalize';

describe('normalizeEmail / normalizeName', () => {
  it('vereinheitlicht Schreibweise und Leerzeichen', () => {
    expect(normalizeEmail('  Jonathan@Fuhrzwei.DE ')).toBe('jonathan@fuhrzwei.de');
    expect(normalizeName('  Jonathan   Fuhr\n')).toBe('Jonathan Fuhr');
  });
});

describe('sanitizeFilename', () => {
  it('entfernt Pfadanteile', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Ordner\\Clip 01.mov')).toBe('Clip 01.mov');
  });

  it('entfernt Steuerzeichen und ersetzt Windows-Sonderzeichen', () => {
    expect(sanitizeFilename('cl\u0000ip\u001f.mov')).toBe('clip.mov');
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.mov')).toBe('a_b_c_d_e_f_g_h.mov');
  });

  it('lässt Umlaute stehen und fängt leere Namen ab', () => {
    expect(sanitizeFilename('Grün_Küche_ÜHD.mov')).toBe('Grün_Küche_ÜHD.mov');
    expect(sanitizeFilename('...')).toBe('datei');
    expect(sanitizeFilename('')).toBe('datei');
  });

  it('begrenzt die Länge', () => {
    expect(sanitizeFilename(`${'x'.repeat(400)}.mov`)).toHaveLength(200);
  });
});

describe('contentDisposition', () => {
  it('liefert ASCII-Fallback und UTF-8-Variante', () => {
    expect(contentDisposition('Grün.mov')).toBe(
      'attachment; filename="Gr_n.mov"; filename*=UTF-8\'\'Gr%C3%BCn.mov',
    );
  });

  it('kann inline ausliefern', () => {
    expect(contentDisposition('clip.mp4', true)).toBe(
      'inline; filename="clip.mp4"; filename*=UTF-8\'\'clip.mp4',
    );
  });

  it('bricht nicht aus dem Header aus', () => {
    const header = contentDisposition('a"b\r\nX-Evil: 1.mov');
    expect(header).not.toContain('\n');
    expect(header).not.toContain('\r');
    expect(header).not.toContain('a"b');
  });
});

import { describe, expect, it } from 'vitest';
import { aworkJobKennung } from './job-kennung';

describe('aworkJobKennung', () => {
  it('verbindet die Teile mit Bindestrich', () => {
    expect(aworkJobKennung('korrekturen', 'abc-123')).toBe('korrekturen-abc-123');
  });

  it('kommt mit einem einzelnen Teil aus', () => {
    expect(aworkJobKennung('projekte-abholen')).toBe('projekte-abholen');
  });

  it('verbindet auch drei Teile', () => {
    expect(aworkJobKennung('erstbesuch', 'nutzer', 'link')).toBe('erstbesuch-nutzer-link');
  });

  /*
   * Die Regel, an der alles hing: BullMQ nimmt keine Kennung mit `:`. Bis
   * 1.7.13 hiessen die Auftraege `korrekturen:<Fassung>` und kamen deshalb nie
   * in die Warteschlange – ohne dass es jemandem auffiel.
   */
  it('enthält niemals einen Doppelpunkt', () => {
    expect(aworkJobKennung('korrekturen', 'a:b')).toBe('korrekturen-a-b');
    expect(aworkJobKennung('a:b', 'c:d:e')).not.toContain(':');
    expect(aworkJobKennung('fassung', '2026-08-19T10:07:22Z')).not.toContain(':');
  });
});

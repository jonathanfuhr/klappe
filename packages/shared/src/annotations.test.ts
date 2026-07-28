import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_COLORS,
  DEFAULT_ANNOTATION_WIDTH,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_ANNOTATION,
  annotationPointCount,
  isAnnotationEmpty,
  sanitizeAnnotation,
} from './annotations';

const stroke = (points: Array<{ x: number; y: number }>) => ({
  color: '#ff3b30',
  width: 0.004,
  points,
});

describe('sanitizeAnnotation', () => {
  it('übernimmt eine saubere Zeichnung', () => {
    const result = sanitizeAnnotation({
      strokes: [stroke([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }])],
    });
    expect(result).toEqual({
      strokes: [{ color: '#ff3b30', width: 0.004, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] }],
    });
  });

  it('klemmt Koordinaten auf das Bild', () => {
    const result = sanitizeAnnotation({ strokes: [stroke([{ x: -3, y: 7 }])] });
    expect(result?.strokes[0].points).toEqual([{ x: 0, y: 1 }]);
  });

  it('rundet auf drei Nachkommastellen', () => {
    const result = sanitizeAnnotation({ strokes: [stroke([{ x: 0.123456, y: 0.987654 }])] });
    expect(result?.strokes[0].points).toEqual([{ x: 0.123, y: 0.988 }]);
  });

  it('ersetzt unbrauchbare Farben durch die Vorgabefarbe', () => {
    const result = sanitizeAnnotation({
      strokes: [{ color: 'javascript:alert(1)', width: 0.004, points: [{ x: 0, y: 0 }] }],
    });
    expect(result?.strokes[0].color).toBe(ANNOTATION_COLORS[0]);
  });

  it('schreibt Farben klein', () => {
    const result = sanitizeAnnotation({
      strokes: [{ color: '#FFCC00', width: 0.004, points: [{ x: 0, y: 0 }] }],
    });
    expect(result?.strokes[0].color).toBe('#ffcc00');
  });

  it('begrenzt die Strichstärke und fängt fehlende Werte ab', () => {
    expect(
      sanitizeAnnotation({ strokes: [{ color: '#ffffff', width: 99, points: [{ x: 0, y: 0 }] }] })
        ?.strokes[0].width,
    ).toBe(0.05);
    expect(
      sanitizeAnnotation({ strokes: [{ color: '#ffffff', points: [{ x: 0, y: 0 }] }] })?.strokes[0]
        .width,
    ).toBe(DEFAULT_ANNOTATION_WIDTH);
  });

  it('lässt einen einzelnen Punkt als Markierung gelten', () => {
    expect(sanitizeAnnotation({ strokes: [stroke([{ x: 0.5, y: 0.5 }])] })?.strokes).toHaveLength(1);
  });

  it('verwirft leere Striche, behält aber die übrigen', () => {
    const result = sanitizeAnnotation({
      strokes: [stroke([]), stroke([{ x: 0.5, y: 0.5 }])],
    });
    expect(result?.strokes).toHaveLength(1);
  });

  it('begrenzt Anzahl der Striche und Punkte', () => {
    const many = Array.from({ length: MAX_STROKES_PER_ANNOTATION + 20 }, () =>
      stroke(
        Array.from({ length: MAX_POINTS_PER_STROKE + 50 }, (_unused, index) => ({
          x: index / 1000,
          y: 0.5,
        })),
      ),
    );
    const result = sanitizeAnnotation({ strokes: many });
    expect(result?.strokes).toHaveLength(MAX_STROKES_PER_ANNOTATION);
    expect(result?.strokes[0].points).toHaveLength(MAX_POINTS_PER_STROKE);
  });

  it('gibt null für alles Unbrauchbare zurück', () => {
    expect(sanitizeAnnotation(null)).toBeNull();
    expect(sanitizeAnnotation('zeichnung')).toBeNull();
    expect(sanitizeAnnotation({})).toBeNull();
    expect(sanitizeAnnotation({ strokes: 'viele' })).toBeNull();
    expect(sanitizeAnnotation({ strokes: [] })).toBeNull();
    expect(sanitizeAnnotation({ strokes: [{ points: [{ x: 'a', y: 1 }] }] })).toBeNull();
  });
});

describe('isAnnotationEmpty / annotationPointCount', () => {
  it('erkennt leere Zeichnungen', () => {
    expect(isAnnotationEmpty(null)).toBe(true);
    expect(isAnnotationEmpty({ strokes: [] })).toBe(true);
    expect(isAnnotationEmpty({ strokes: [stroke([{ x: 0, y: 0 }])] })).toBe(false);
  });

  it('zählt alle Punkte', () => {
    expect(
      annotationPointCount({
        strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]), stroke([{ x: 0.5, y: 0.5 }])],
      }),
    ).toBe(3);
  });
});

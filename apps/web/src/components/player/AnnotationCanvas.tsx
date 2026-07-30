'use client';

import {
  type Annotation,
  type AnnotationStroke,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_ANNOTATION,
} from '@klappe/shared';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react';

interface AnnotationCanvasProps {
  /** Was gezeichnet werden soll. */
  annotation: Annotation | null;
  /** `true` schaltet den Stift ein; sonst ist die Fläche nur Anzeige. */
  drawing: boolean;
  color: string;
  strokeWidth: number;
  onChange?: (annotation: Annotation) => void;
}

/**
 * Zeichenfläche über dem Videobild (Phase 5).
 *
 * Alle Koordinaten liegen normalisiert (0…1) vor, siehe
 * `packages/shared/src/annotations.ts`. Die Leinwand selbst hat immer die
 * Pixelgröße ihres Containers – dadurch bleibt die Zeichnung beim Wechsel
 * zwischen Fenster und Vollbild an derselben Stelle im Bild.
 */
export function AnnotationCanvas({
  annotation,
  drawing,
  color,
  strokeWidth,
  onChange,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<AnnotationStroke | null>(null);
  /** Während des Zeichnens die Wahrheit – der Zustand von außen hinkt sonst nach. */
  const current = useRef<Annotation>({ strokes: [] });

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const strokes = [
      ...current.current.strokes,
      ...(activeStroke.current ? [activeStroke.current] : []),
    ];

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.lineWidth = Math.max(1, stroke.width * height);

      if (stroke.points.length === 1) {
        // Ein einzelnes Tippen ist ein Punkt, keine Linie.
        const point = stroke.points[0];
        context.beginPath();
        context.arc(point.x * width, point.y * height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }

      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  }, []);

  /** Leinwand an die Anzeigegröße anpassen (auch bei Vollbild). */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      paint();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    current.current = annotation ? { strokes: annotation.strokes.map((stroke) => ({ ...stroke })) } : { strokes: [] };
    paint();
  }, [annotation, paint]);

  const pointFrom = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    if (current.current.strokes.length >= MAX_STROKES_PER_ANNOTATION) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStroke.current = { color, width: strokeWidth, points: [pointFrom(event)] };
    paint();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStroke.current;
    if (!drawing || !stroke) return;
    if (stroke.points.length >= MAX_POINTS_PER_STROKE) return;

    const point = pointFrom(event);
    const last = stroke.points[stroke.points.length - 1];
    // Winzige Bewegungen erzeugen sonst Hunderte fast gleicher Punkte.
    if (Math.abs(point.x - last.x) < 0.002 && Math.abs(point.y - last.y) < 0.002) return;

    stroke.points.push(point);
    paint();
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStroke.current;
    if (!stroke) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    activeStroke.current = null;
    current.current = { strokes: [...current.current.strokes, stroke] };
    paint();
    onChange?.({ strokes: current.current.strokes.map((entry) => ({ ...entry })) });
  };

  return (
    <canvas
      ref={canvasRef}
      className="annotation-canvas"
      data-drawing={drawing}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    />
  );
}

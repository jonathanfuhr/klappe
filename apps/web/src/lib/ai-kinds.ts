'use client';

import type { AiKindDto } from '@klappe/shared';
import { type MessageKey, type Translator, useT } from './i18n';

/**
 * Wie heißt eine KI-Art in der gewählten Sprache? (Phase 26)
 *
 * Nur die vier ab Werk mitgelieferten Arten sind übersetzbar – die legt
 * niemand an, die liefern wir aus. Alles, was ein Admin unter
 * *Einstellungen → KI-Inhalte* selbst anlegt, bleibt so stehen, wie er es
 * eingetippt hat. Das ist keine Bequemlichkeit: Eine selbst vergebene
 * Bezeichnung ist ein Wort, über das Menschen reden und nach dem sie suchen.
 * Sie zu übersetzen hieße, dass zwei Kollegen an zwei Bildschirmen nicht mehr
 * dasselbe Wort für dieselbe Sache sehen.
 *
 * Die Zuordnung steht ausdrücklich hier und nicht als zusammengebauter
 * Schlüssel: Ein unbekannter Code aus der Datenbank fällt damit auf `name`
 * zurück, statt als Rohschlüssel in der Oberfläche zu landen.
 */
const SCHLUESSEL: Record<string, MessageKey> = {
  voice: 'aiKind.voice',
  video: 'aiKind.video',
  sounds: 'aiKind.sounds',
  music: 'aiKind.music',
};

export function aiKindName(kind: AiKindDto, t: Translator): string {
  const schluessel = kind.key ? SCHLUESSEL[kind.key] : undefined;
  return schluessel ? t(schluessel) : kind.name;
}

/** Dasselbe, an die geltende Sprache gebunden – der Normalfall in Komponenten. */
export function useAiKindName(): (kind: AiKindDto) => string {
  const t = useT();
  return (kind: AiKindDto) => aiKindName(kind, t);
}

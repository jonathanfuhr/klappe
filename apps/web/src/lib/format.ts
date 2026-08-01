'use client';

import type { Locale } from '@klappe/shared';
import { DEFAULT_LOCALE } from '@klappe/shared';
import { useMemo } from 'react';
import { useLocale } from './i18n';

/**
 * Anzeigehelfer für die Oberfläche – seit Phase 26 in der gewählten Sprache.
 *
 * Datum, Uhrzeit, Dezimaltrennzeichen und „vor zwei Tagen" sind nichts, was
 * in ein Wörterbuch gehört: Das kann `Intl` besser und für jede Sprache, die
 * je dazukommt. Deutsch bekommt „1.536,7 MB" und „vorgestern", Englisch
 * „1,536.7 MB" und „2 days ago" – ohne einen einzigen Eintrag von Hand.
 *
 * Die Funktionen bleiben rein und nehmen die Sprache als Wert entgegen. Wer
 * in einer Komponente steht, nimmt `useFormat()` und bekommt sie fertig
 * gebunden; die Aufrufe sehen dann aus wie vorher.
 */

/*
 * Ein `Intl`-Formatierer ist teuer zu bauen. Bei einer Liste mit hundert
 * Zeitangaben wäre das hundertmal derselbe Aufbau, deshalb je Sprache einmal
 * merken.
 */
const datumsFormate = new Map<string, Intl.DateTimeFormat>();
const zeitFormate = new Map<string, Intl.RelativeTimeFormat>();
const zahlFormate = new Map<string, Intl.NumberFormat>();

function datumsFormat(locale: Locale): Intl.DateTimeFormat {
  let format = datumsFormate.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    datumsFormate.set(locale, format);
  }
  return format;
}

function zeitFormat(locale: Locale): Intl.RelativeTimeFormat {
  let format = zeitFormate.get(locale);
  if (!format) {
    // `numeric: 'auto'` macht aus „vor 1 Tag" ein „gestern" – dieselbe
    // Freundlichkeit gibt es in jeder Sprache, die `Intl` kennt.
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    zeitFormate.set(locale, format);
  }
  return format;
}

function zahlFormat(locale: Locale, nachkommastellen: number): Intl.NumberFormat {
  const schluessel = `${locale}:${nachkommastellen}`;
  let format = zahlFormate.get(schluessel);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: nachkommastellen });
    zahlFormate.set(schluessel, format);
  }
  return format;
}

export function formatDateTime(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '–' : datumsFormat(locale).format(date);
}

/** „vor 5 Min." für frische Einträge, sonst das Datum. */
export function formatRelative(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const format = zeitFormat(locale);
  // Negativ, weil es um Vergangenes geht: −5 Minuten heißt „vor 5 Minuten".
  if (seconds < 60) return format.format(0, 'second');
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return format.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 86400 * 7) return format.format(-Math.floor(seconds / 86400), 'day');
  // Älteres als eine Woche wird als Datum genauer – „vor 3 Monaten" hilft
  // niemandem, der wissen will, wann genau.
  return datumsFormat(locale).format(date);
}

export function formatBytes(bytes: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${zahlFormat(locale, 0).format(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${zahlFormat(locale, value >= 100 ? 0 : 1).format(value)} ${units[unitIndex]}`;
}

export function formatFrameRate(
  frameRate: { num: number; den: number } | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!frameRate) return '–';
  const value = frameRate.num / frameRate.den;
  return `${zahlFormat(locale, 2).format(value)} fps`;
}

/** Sprachneutral: Anfangsbuchstaben sind Anfangsbuchstaben. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * Dieselben Helfer, an die geltende Sprache gebunden. Ein Aufruf je
 * Komponente, danach bleiben die Aufrufstellen wie zuvor:
 *
 *     const { formatRelative } = useFormat();
 *     …
 *     {formatRelative(video.updatedAt)}
 */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      formatDateTime: (iso: string) => formatDateTime(iso, locale),
      formatRelative: (iso: string) => formatRelative(iso, locale),
      formatBytes: (bytes: number) => formatBytes(bytes, locale),
      formatFrameRate: (frameRate: { num: number; den: number } | null) =>
        formatFrameRate(frameRate, locale),
    }),
    [locale],
  );
}

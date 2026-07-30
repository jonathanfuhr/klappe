/**
 * Anfragebremse für die empfindlichen Routen (Phase 13).
 *
 * Bewusst im Prozessspeicher und nicht in Redis: Der Container betreibt laut
 * Konzept genau eine API-Instanz. Ein Zähler in Redis wäre dieselbe Rechnung
 * mit einem Netzwerkweg dazwischen. Wird das später mehrinstanzig, ist genau
 * diese Klasse die Stelle, die zu ersetzen ist.
 *
 * Verfahren: gleitendes Zeitfenster über die Zeitstempel der letzten
 * Versuche. Genauer als ein festes Fenster, in dem man an der Grenze das
 * Doppelte unterbringt.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Wie viele Versuche im Fenster noch frei sind. */
  remaining: number;
  /** Sekunden bis zum nächsten freien Versuch; 0, wenn gerade frei. */
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Erlaubte Versuche je Fenster. */
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Zählt einen Versuch und entscheidet. Abgelehnte Versuche zählen bewusst
   * **nicht** mit – sonst könnte sich jemand durch stures Weiterklopfen selbst
   * dauerhaft aussperren, und ein Angreifer sperrte damit fremde Konten aus.
   */
  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const jetzt = this.now();
    const grenze = jetzt - rule.windowMs;

    const bisher = (this.hits.get(key) ?? []).filter((zeit) => zeit > grenze);

    if (bisher.length >= rule.limit) {
      const aeltester = bisher[0];
      this.hits.set(key, bisher);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((aeltester + rule.windowMs - jetzt) / 1000)),
      };
    }

    bisher.push(jetzt);
    this.hits.set(key, bisher);
    return { allowed: true, remaining: rule.limit - bisher.length, retryAfterSeconds: 0 };
  }

  /** Nach erfolgreicher Anmeldung: Die Bremse soll niemanden länger stören. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /**
   * Räumt Schlüssel weg, deren Versuche alle aus dem Fenster gefallen sind.
   * Ohne das wüchse die Tabelle mit jeder je gesehenen Adresse.
   */
  sweep(maxWindowMs: number): number {
    const grenze = this.now() - maxWindowMs;
    let entfernt = 0;
    for (const [key, zeiten] of this.hits) {
      const uebrig = zeiten.filter((zeit) => zeit > grenze);
      if (uebrig.length === 0) {
        this.hits.delete(key);
        entfernt += 1;
      } else if (uebrig.length !== zeiten.length) {
        this.hits.set(key, uebrig);
      }
    }
    return entfernt;
  }

  get size(): number {
    return this.hits.size;
  }
}

/**
 * Schlüssel aus Route und Herkunft. Die Adresse allein wäre zu grob – hinter
 * einem Firmenanschluss sitzen viele Leute unter derselben IP; deshalb geht,
 * wo vorhanden, die genannte Kennung (E-Mail) mit ein.
 */
export function rateKey(route: string, ip: string, identity?: string | null): string {
  return identity ? `${route}|${identity.toLowerCase()}` : `${route}|ip:${ip}`;
}

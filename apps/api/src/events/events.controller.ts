import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { type Observable, filter, from, map, merge, mergeMap, of, interval } from 'rxjs';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { EventsService, type KlappeEvent } from './events.service';

/** Alle 25 Sekunden ein Lebenszeichen – sonst kappt mancher Proxy die Leitung. */
const HEARTBEAT_MS = 25_000;

/**
 * Der Ereignisstrom (Phase 18, Zusatz).
 *
 * Eine Verbindung je offener Seite. Was hier hinausgeht, ist bewusst inhaltslos
 * – nur „an dieser Stelle hat sich etwas getan“. Die Oberfläche holt sich die
 * Daten danach über die gewohnten, rechtegeprüften Wege.
 *
 * Für Gäste wird trotzdem gefiltert: Schon die Kennung eines fremden Videos
 * ist eine Auskunft, die ihnen nicht zusteht. Ihr Zugriff wird je Ereignis
 * frisch geladen – Ereignisse sind selten, und ein entzogener Zugang soll
 * sofort wirken.
 */
@Controller('v1/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly accessService: AccessService,
  ) {}

  @Sse()
  stream(@CurrentUser() user: RequestUser): Observable<MessageEvent> {
    const nachrichten = this.events.events().pipe(
      mergeMap((event) => from(this.darfSehen(user, event)).pipe(filter(Boolean), map(() => event))),
      map((event: KlappeEvent) => ({ data: event }) as MessageEvent),
    );

    // Der Herzschlag hält die Leitung offen und sagt der Oberfläche zugleich,
    // dass die Verbindung noch steht.
    const herzschlag = interval(HEARTBEAT_MS).pipe(
      map(() => ({ type: 'ping', data: {} }) as MessageEvent),
    );

    // Ein erstes Lebenszeichen sofort: Damit weiß der Browser, dass die
    // Verbindung wirklich steht, und schaltet das Nachladen herunter.
    return merge(of({ type: 'ping', data: {} } as MessageEvent), nachrichten, herzschlag);
  }

  private async darfSehen(user: RequestUser, event: KlappeEvent): Promise<boolean> {
    if (event.topic === 'notification') return event.userId === user.id;
    if (user.role !== 'GUEST') return true;
    if (!event.projectId) return false;

    const scope = await this.accessService.loadScope(user);
    return this.accessService.visibleProjects(scope).includes(event.projectId);
  }
}

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { CONFIG, type AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Der Body wird gleich selbst verdrahtet: Upload-Chunks dürfen nicht
    // durch den JSON-Parser laufen, sonst landet die Videodatei im Speicher.
    bodyParser: false,
  });

  const config = app.get<AppConfig>(CONFIG);
  const logger = new Logger('Bootstrap');

  // Hinter einem Reverse Proxy (Caddy, Cloudflared, Traefik) stehen Schema
  // und Client-Adresse in den X-Forwarded-Headern. Ohne dieses Vertrauen
  // hielte Express jede Anfrage für unverschlüsselt.
  app.set('trust proxy', 1);

  const json = express.json({ limit: '1mb' });
  /**
   * Nur der Chunk-Endpunkt selbst darf am JSON-Parser vorbei – dort liegen
   * Videodaten im Body, die niemals in den Speicher gelesen werden dürfen.
   *
   * Früher stand hier `startsWith('/v1/uploads/')`, und damit fiel jede
   * weitere Route unter diesem Pfad mit heraus. Die Zuordnung
   * (`/v1/uploads/:id/ziel`) bekam so nie einen Body: Der Aufruf lief durch,
   * tat aber nichts – ein Fehler, den keine Typprüfung findet.
   */
  const istChunkAnfrage = (request: express.Request): boolean =>
    /^\/v1\/uploads\/[^/]+$/.test(request.path);
  app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (istChunkAnfrage(request)) return next();
    return json(request, response, next);
  });
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();

  await app.get(AuthService).ensureBootstrapAdmin();

  // Diese Kombination kann nicht funktionieren, scheitert aber lautlos: Der
  // Browser nimmt das Cookie gar nicht erst an, die Anmeldung bleibt ohne
  // Fehlermeldung stehen. Lieber einmal zu viel im Log als eine Stunde Suche.
  if (config.jwt.cookieSecure && !config.publicUrl.startsWith('https://')) {
    logger.warn(
      `SESSION_COOKIE_SECURE ist an, PUBLIC_URL ist aber ${config.publicUrl} – ` +
        'ohne HTTPS verwirft der Browser das Sitzungs-Cookie und die Anmeldung ' +
        'bleibt stehen. Zum Testen ohne TLS: SESSION_COOKIE_SECURE=0 setzen.',
    );
  }

  await app.listen(config.port, '0.0.0.0');
  logger.log(`Klappe-API läuft auf Port ${config.port} (${config.nodeEnv}).`);
}

void bootstrap();

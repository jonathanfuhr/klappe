import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessModule } from './access/access.module';
import { EventsModule } from './events/events.module';
import { BackupModule } from './backup/backup.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CommentsModule } from './comments/comments.module';
import { AppConfigModule } from './config/config.module';
import { RateLimitGuard } from './common/rate-limit.guard';
import { DbModule } from './db/db.module';
import { GuestsModule } from './guests/guests.module';
import { HealthController } from './health/health.controller';
import { I18nModule } from './i18n/i18n.module';
import { MailModule } from './mail/mail.module';
import { MediaModule } from './media/media.module';
import { ProjectFilesModule } from './project-files/project-files.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { RenditionsModule } from './renditions/renditions.module';
import { SettingsModule } from './settings/settings.module';
import { TranscodeSettingsModule } from './settings/transcode-settings.module';
import { EmbedModule } from './embed/embed.module';
import { SharesModule } from './shares/shares.module';
import { StorageModule } from './storage/storage.module';
import { TagsModule } from './tags/tags.module';
import { AiContentModule } from './ai/ai-content.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { VersionsModule } from './versions/versions.module';
import { VideosModule } from './videos/videos.module';

/**
 * Der HTTP-Dienst. Er reiht Transcoding- und Mail-Aufgaben nur ein –
 * ausgeführt werden sie im Worker-Prozess (`worker.ts`), damit ffmpeg und ein
 * langsamer Mailserver die API nicht blockieren.
 */
@Module({
  imports: [
    BackupModule,
    AppConfigModule,
    DbModule,
    I18nModule,
    StorageModule,
    AccessModule,
    EventsModule,
    TranscodeSettingsModule,
    JwtModule.register({}),
    QueueModule,
    MailModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    VideosModule,
    VersionsModule,
    UploadsModule,
    MediaModule,
    RenditionsModule,
    CommentsModule,
    SharesModule,
    EmbedModule,
    GuestsModule,
    ProjectFilesModule,
    SettingsModule,
    TagsModule,
    AiContentModule,
  ],
  controllers: [HealthController],
  providers: [
    // Angemeldet sein ist die Voreinstellung; Ausnahmen tragen `@Public()`.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Die Bremse greift nur, wo eine Route sie mit `@RateLimit` anfordert.
    RateLimitGuard,
    { provide: APP_GUARD, useExisting: RateLimitGuard },
  ],
})
export class AppModule {}

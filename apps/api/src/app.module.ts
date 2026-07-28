import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CommentsModule } from './comments/comments.module';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { VersionsModule } from './versions/versions.module';
import { VideosModule } from './videos/videos.module';

/**
 * Der HTTP-Dienst. Er reiht Transcoding-Jobs nur ein – ausgeführt werden sie
 * im Worker-Prozess (`worker.ts`), damit ffmpeg nicht die API blockiert.
 */
@Module({
  imports: [
    AppConfigModule,
    DbModule,
    StorageModule,
    JwtModule.register({}),
    QueueModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    VideosModule,
    VersionsModule,
    UploadsModule,
    MediaModule,
    CommentsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Angemeldet sein ist die Voreinstellung; Ausnahmen tragen `@Public()`.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

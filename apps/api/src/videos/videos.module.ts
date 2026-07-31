import { Module } from '@nestjs/common';
import { AiContentModule } from '../ai/ai-content.module';
import { ProjectsModule } from '../projects/projects.module';
import { VersionsModule } from '../versions/versions.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  // AiContentModule liefert die KI-Kennzeichnung am Video (Phase 24, Nachtrag).
  imports: [ProjectsModule, VersionsModule, AiContentModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}

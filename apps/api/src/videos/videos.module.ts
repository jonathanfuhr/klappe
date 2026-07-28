import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { VersionsModule } from '../versions/versions.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [ProjectsModule, VersionsModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}

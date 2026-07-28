import { Module } from '@nestjs/common';
import { ProjectFilesModule } from '../project-files/project-files.module';
import { ProjectsModule } from '../projects/projects.module';
import { QueueModule } from '../queue/queue.module';
import { VersionsModule } from '../versions/versions.module';
import { VideosModule } from '../videos/videos.module';
import { UploadsCleanupService } from './uploads-cleanup.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [VersionsModule, VideosModule, ProjectsModule, ProjectFilesModule, QueueModule],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsCleanupService],
  exports: [UploadsService],
})
export class UploadsModule {}

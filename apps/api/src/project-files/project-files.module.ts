import { Module } from '@nestjs/common';
import { ProjectFilesController } from './project-files.controller';
import { ProjectFilesService } from './project-files.service';

@Module({
  controllers: [ProjectFilesController],
  providers: [ProjectFilesService],
  exports: [ProjectFilesService],
})
export class ProjectFilesModule {}

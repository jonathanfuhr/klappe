import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectFilesController } from './project-files.controller';
import { ProjectFilesService } from './project-files.service';
import { ProjectFoldersService } from './project-folders.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ProjectFilesController],
  providers: [ProjectFilesService, ProjectFoldersService],
  exports: [ProjectFilesService, ProjectFoldersService],
})
export class ProjectFilesModule {}

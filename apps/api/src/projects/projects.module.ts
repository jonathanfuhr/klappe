import { Module } from '@nestjs/common';
import { ProjectFieldsController } from './project-fields.controller';
import { ProjectFieldsService } from './project-fields.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, ProjectFieldsController],
  providers: [ProjectsService, ProjectFieldsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}

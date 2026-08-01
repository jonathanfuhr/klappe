import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ProjectFieldsController } from './project-fields.controller';
import { ProjectFieldsService } from './project-fields.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  // Wegen der Eintragung des Projekterstellers in die Benachrichtigungen
  // (Phase 28) – der `SubscriptionsService` kommt aus dem Mail-Modul.
  imports: [MailModule],
  controllers: [ProjectsController, ProjectFieldsController],
  providers: [ProjectsService, ProjectFieldsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}

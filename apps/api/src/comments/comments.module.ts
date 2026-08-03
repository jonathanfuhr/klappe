import { Module } from '@nestjs/common';
import { AworkModule } from '../awork/awork.module';
import { QueueModule } from '../queue/queue.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  // `AworkModule` steuert den Auslöser bei, der die Korrektur-Aufgabe
  // anstößt – eingereiht wird, ausgeführt wird im Worker (Phase 30).
  imports: [QueueModule, AworkModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}

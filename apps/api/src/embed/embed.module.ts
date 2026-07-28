import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EmbedController } from './embed.controller';
import { EmbedService } from './embed.service';

@Module({
  imports: [StorageModule],
  controllers: [EmbedController],
  providers: [EmbedService],
})
export class EmbedModule {}

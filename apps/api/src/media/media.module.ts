import { Module } from '@nestjs/common';
import { VersionsModule } from '../versions/versions.module';
import { MediaController } from './media.controller';

@Module({
  imports: [VersionsModule],
  controllers: [MediaController],
})
export class MediaModule {}

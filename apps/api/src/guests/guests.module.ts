import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SharesModule } from '../shares/shares.module';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

@Module({
  // MailModule seit Phase 20: Wer neu freigeschaltet wird, bekommt einen
  // kurzen Hinweis – vorher geschah das lautlos.
  imports: [SharesModule, MailModule],
  controllers: [GuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}

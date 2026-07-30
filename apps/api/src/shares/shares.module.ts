import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { GuestAccessController } from './guest-access.controller';
import { GuestLoginController } from './guest-login.controller';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  imports: [MailModule, AuthModule, UsersModule],
  controllers: [SharesController, GuestAccessController, GuestLoginController],
  providers: [SharesService],
  exports: [SharesService],
})
export class SharesModule {}

import { Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AccessTokenService, AuthService],
  exports: [AccessTokenService, AuthService],
})
export class AuthModule {}

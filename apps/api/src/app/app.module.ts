import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from '../db/drizzle.module';
import { HealthModule } from '../health/health.module';
import { AuthModule } from '../identity-and-access/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [DrizzleModule, HealthModule, AuthModule, UserModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

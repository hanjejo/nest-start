import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { AccessTokenGuard } from './access-token.guard';
import { PermissionGuard } from './permission.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { StoreCapabilityController } from './store-capability.controller';

@Module({
  imports: [AuthModule],
  controllers: [RbacController, StoreCapabilityController],
  providers: [AccessTokenGuard, PermissionGuard, RbacService],
  exports: [AccessTokenGuard, PermissionGuard, RbacService],
})
export class RbacModule {}

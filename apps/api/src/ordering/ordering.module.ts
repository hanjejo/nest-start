import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { AccessTokenGuard } from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RbacModule } from '../rbac/rbac.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OrderingController } from './ordering.controller';
import { OrderingService } from './ordering.service';

@Module({
  imports: [AuthModule, RbacModule, MessagingModule],
  controllers: [OrderingController],
  providers: [OrderingService, AccessTokenGuard, PermissionGuard],
  exports: [OrderingService],
})
export class OrderingModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { AccessTokenGuard } from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RbacModule } from '../rbac/rbac.module';
import { StoreManagementController } from './store-management.controller';
import { StoreManagementService } from './store-management.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [StoreManagementController],
  providers: [StoreManagementService, AccessTokenGuard, PermissionGuard],
  exports: [StoreManagementService],
})
export class StoreManagementModule {}

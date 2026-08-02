import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { AccessTokenGuard } from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RbacModule } from '../rbac/rbac.module';
import { PerformanceModule } from '../performance/performance.module';
import { StoreManagementModule } from '../store-management/store-management.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [AuthModule, RbacModule, PerformanceModule, StoreManagementModule],
  controllers: [CatalogController],
  providers: [CatalogService, AccessTokenGuard, PermissionGuard],
})
export class CatalogModule {}

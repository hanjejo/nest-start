import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from '../db/drizzle.module';
import { HealthModule } from '../health/health.module';
import { AuthModule } from '../identity-and-access/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { CatalogModule } from '../catalog/catalog.module';
import { StoreManagementModule } from '../store-management/store-management.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    DrizzleModule,
    HealthModule,
    AuthModule,
    RbacModule,
    StoreManagementModule,
    CatalogModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

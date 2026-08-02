import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './rbac.decorators';
import { RBAC_PERMISSIONS } from './rbac.constants';
import {
  BootstrapDto,
  CreateAssignmentDto,
  CreatePermissionDto,
  CreateRoleDto,
  CreateRolePermissionDto,
  CreateStoreDto,
} from './rbac.dto';
import { RbacService } from './rbac.service';

@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_CATALOG_READ)
  listRoles() {
    return this.rbacService.listRoles();
  }

  @Post('roles')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_CATALOG_WRITE)
  createRole(@Body() body: CreateRoleDto) {
    return this.rbacService.createRole(body);
  }

  @Get('permissions')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_CATALOG_READ)
  listPermissions() {
    return this.rbacService.listPermissions();
  }

  @Post('permissions')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_CATALOG_WRITE)
  createPermission(@Body() body: CreatePermissionDto) {
    return this.rbacService.createPermission(body);
  }

  @Post('role-permissions')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_CATALOG_WRITE)
  createRolePermission(@Body() body: CreateRolePermissionDto) {
    return this.rbacService.createRolePermission(body);
  }

  @Get('assignments')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_ASSIGNMENT_READ)
  listAssignments(
    @Query('userId') userId?: string,
    @Query('storeId') storeId?: string,
    @Query('role') role?: string,
  ) {
    return this.rbacService.listAssignments({ userId, storeId, role });
  }

  @Post('assignments')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_ASSIGNMENT_WRITE)
  createAssignment(@Body() body: CreateAssignmentDto) {
    return this.rbacService.createAssignment(body);
  }

  @Get('stores')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.RBAC_ASSIGNMENT_READ)
  listStores() {
    return this.rbacService.listStores();
  }

  @Post('stores')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.STORE_SCOPE_MANAGE)
  createStore(@Body() body: CreateStoreDto) {
    return this.rbacService.createStore(body);
  }

  @Post('bootstrap')
  bootstrap(
    @Body() body: BootstrapDto,
    @Headers('x-rbac-bootstrap-token') bootstrapToken?: string,
  ) {
    return this.rbacService.bootstrap(body?.userId, bootstrapToken);
  }
}

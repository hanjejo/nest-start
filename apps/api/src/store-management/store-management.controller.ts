import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RequirePermission } from '../rbac/rbac.decorators';
import { RBAC_PERMISSIONS } from '../rbac/rbac.constants';
import { UpdateStoreOperationsDto } from './store-management.dto';
import { StoreManagementService } from './store-management.service';

@Controller('stores')
export class StoreManagementController {
  constructor(
    private readonly storeManagementService: StoreManagementService,
  ) {}

  @Get(':storeId/operations')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.STORE_OPERATIONS_MANAGE, {
    storeIdParam: 'storeId',
  })
  getOperations(@Param('storeId') storeId: string) {
    return this.storeManagementService.getOperations(storeId);
  }

  @Patch(':storeId/operations')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.STORE_OPERATIONS_MANAGE, {
    storeIdParam: 'storeId',
  })
  updateOperations(
    @Param('storeId') storeId: string,
    @Body() body: UpdateStoreOperationsDto,
  ) {
    return this.storeManagementService.updateOperations(storeId, body);
  }
}

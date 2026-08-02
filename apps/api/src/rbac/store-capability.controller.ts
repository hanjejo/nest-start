import {
  Controller,
  Get,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, AuthenticatedRequest } from './access-token.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './rbac.decorators';
import { RBAC_PERMISSIONS } from './rbac.constants';
import { RbacService } from './rbac.service';

@Controller('stores')
export class StoreCapabilityController {
  constructor(private readonly rbacService: RbacService) {}

  @Get(':storeId/workspace')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.STORE_SCOPE_READ, {
    storeIdParam: 'storeId',
  })
  getWorkspace(
    @Param('storeId') storeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.rbacService.getStoreCapability(storeId, request.user.sub);
  }
}

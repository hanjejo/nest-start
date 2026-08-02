import {
  Controller,
  Get,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RequirePermission } from '../rbac/rbac.decorators';
import { RBAC_PERMISSIONS } from '../rbac/rbac.constants';
import { SettlementService } from './settlement.service';

@Controller()
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get('settlements/:settlementId')
  @UseGuards(AccessTokenGuard)
  get(
    @Req() request: AuthenticatedRequest,
    @Param('settlementId') settlementId: string,
  ) {
    return this.settlementService.getForUser(
      this.userId(request),
      settlementId,
    );
  }

  @Get('orders/:orderId/settlement')
  @UseGuards(AccessTokenGuard)
  getForOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    return this.settlementService.getForOrder(this.userId(request), orderId);
  }

  @Get('stores/:storeId/settlements')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.SETTLEMENT_READ_STORE, {
    storeIdParam: 'storeId',
  })
  listForStore(
    @Req() request: AuthenticatedRequest,
    @Param('storeId') storeId: string,
  ) {
    return this.settlementService.listForStore(this.userId(request), storeId);
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.user.sub;
  }
}

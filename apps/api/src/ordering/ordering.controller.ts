import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { CreateOrderDto } from './ordering.dto';
import { OrderingService } from './ordering.service';

@Controller()
export class OrderingController {
  constructor(private readonly orderingService: OrderingService) {}

  @Post('orders')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.ORDER_CREATE)
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateOrderDto) {
    return this.orderingService.create(this.userId(request), body);
  }

  @Get('orders')
  @UseGuards(AccessTokenGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query('storeId') storeId?: string,
  ) {
    return this.orderingService.list(this.userId(request), storeId);
  }

  @Get('stores/:storeId/orders')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.ORDER_READ_STORE, {
    storeIdParam: 'storeId',
  })
  listForStore(
    @Req() request: AuthenticatedRequest,
    @Param('storeId') storeId: string,
  ) {
    return this.orderingService.listForStore(this.userId(request), storeId);
  }

  @Get('orders/:orderId')
  @UseGuards(AccessTokenGuard)
  get(@Req() request: AuthenticatedRequest, @Param('orderId') orderId: string) {
    return this.orderingService.get(this.userId(request), orderId);
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    return this.orderingService.cancel(this.userId(request), orderId);
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.user.sub;
  }
}

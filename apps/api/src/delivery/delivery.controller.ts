import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../rbac/access-token.guard';
import { DeliveryService } from './delivery.service';

@Controller()
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get('deliveries/:deliveryId')
  @UseGuards(AccessTokenGuard)
  get(
    @Req() request: AuthenticatedRequest,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.deliveryService.getForUser(this.userId(request), deliveryId);
  }

  @Get('orders/:orderId/delivery')
  @UseGuards(AccessTokenGuard)
  getForOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    return this.deliveryService.getForOrder(this.userId(request), orderId);
  }

  @Get('stores/:storeId/deliveries')
  @UseGuards(AccessTokenGuard)
  listForStore(
    @Req() request: AuthenticatedRequest,
    @Param('storeId') storeId: string,
  ) {
    return this.deliveryService.listForStore(this.userId(request), storeId);
  }

  @Post('deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AccessTokenGuard)
  retry(
    @Req() request: AuthenticatedRequest,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.deliveryService.retryForUser(this.userId(request), deliveryId);
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.user.sub;
  }
}

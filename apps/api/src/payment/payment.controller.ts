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
import { PaymentService } from './payment.service';

@Controller()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('payments/:paymentIntentId')
  @UseGuards(AccessTokenGuard)
  get(
    @Req() request: AuthenticatedRequest,
    @Param('paymentIntentId') paymentIntentId: string,
  ) {
    return this.paymentService.getForUser(
      this.userId(request),
      paymentIntentId,
    );
  }

  @Get('orders/:orderId/payment')
  @UseGuards(AccessTokenGuard)
  getForOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    return this.paymentService.getForOrder(this.userId(request), orderId);
  }

  @Post('payments/:paymentIntentId/attempts')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AccessTokenGuard)
  retry(
    @Req() request: AuthenticatedRequest,
    @Param('paymentIntentId') paymentIntentId: string,
  ) {
    return this.paymentService.retryForUser(
      this.userId(request),
      paymentIntentId,
    );
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.user.sub;
  }
}

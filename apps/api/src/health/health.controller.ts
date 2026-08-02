import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    const health = await this.healthService.check();
    response.status(
      health.status === 'error'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK,
    );
    return health;
  }
}

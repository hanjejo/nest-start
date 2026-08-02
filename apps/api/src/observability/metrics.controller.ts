import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async render(@Res() response: Response): Promise<void> {
    response
      .type(this.metrics.contentType)
      .send(await this.metrics.render());
  }
}

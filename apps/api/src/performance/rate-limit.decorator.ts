import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_OPTIONS } from './performance.constants';

export type RateLimitOptions = Readonly<{
  key: string;
  limit?: number;
  windowSeconds?: number;
}>;

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_OPTIONS, options);

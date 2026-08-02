import type { ProductLifecycle } from '../db/schema';

export class CreateProductDto {
  name!: string;
  description?: string;
  lifecycle?: ProductLifecycle;
  menuVisible?: boolean;
  priceMinor?: number;
  currency?: string;
}

export class UpdateProductDto {
  name?: string;
  description?: string;
  lifecycle?: ProductLifecycle;
  menuVisible?: boolean;
  priceMinor?: number;
  currency?: string;
}

export class CreateProductPriceDto {
  amountMinor!: number;
  currency?: string;
}

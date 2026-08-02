export class CreateOrderItemDto {
  productId!: string;
  quantity!: number;
}

export class CreateOrderDto {
  storeId!: string;
  items!: CreateOrderItemDto[];
  address?: Record<string, unknown>;
  deliveryAddress?: Record<string, unknown>;
  addressSnapshot?: Record<string, unknown>;
}

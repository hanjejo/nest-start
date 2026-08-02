export class CreateOrderItemDto {
  productId!: string;
  quantity!: number;
}

export class CreateOrderDto {
  storeId!: string;
  items!: CreateOrderItemDto[];
}

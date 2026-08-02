import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  ProductLifecycle,
  ProductPrice,
  productLifecycles,
  productPrices,
  products,
} from '../db/schema';
import {
  StoreManagementService,
  isStoreOrderable,
} from '../store-management/store-management.service';
import {
  CreateProductDto,
  CreateProductPriceDto,
  UpdateProductDto,
} from './catalog.dto';

const MAX_PRODUCT_NAME_LENGTH = 200;
const MAX_PRODUCT_DESCRIPTION_LENGTH = 2_000;
const MAX_MINOR_AMOUNT = 2_147_483_647;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

type ProductRow = typeof products.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Invalid ${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return normalized;
}

function normalizeDescription(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (
    typeof value !== 'string' ||
    value.trim().length > MAX_PRODUCT_DESCRIPTION_LENGTH
  ) {
    throw new BadRequestException('Invalid product description');
  }
  return value.trim();
}

function normalizeLifecycle(value: unknown): ProductLifecycle {
  if (
    typeof value !== 'string' ||
    !productLifecycles.includes(value as ProductLifecycle)
  ) {
    throw new BadRequestException('Invalid product lifecycle');
  }
  return value as ProductLifecycle;
}

function normalizeMenuVisible(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException('Invalid menu visibility');
  }
  return value;
}

function normalizeAmountMinor(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_MINOR_AMOUNT
  ) {
    throw new BadRequestException('Invalid price amountMinor');
  }
  return value;
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Invalid price currency');
  }
  const currency = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new BadRequestException('Invalid price currency');
  }
  return currency;
}

function assertLifecycleTransition(
  current: ProductLifecycle,
  next: ProductLifecycle,
): void {
  if (current === next) {
    return;
  }
  const allowed: Record<ProductLifecycle, ProductLifecycle[]> = {
    DRAFT: ['PUBLISHED', 'ARCHIVED'],
    PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'],
    UNPUBLISHED: ['PUBLISHED', 'ARCHIVED'],
    ARCHIVED: [],
  };
  if (!allowed[current].includes(next)) {
    throw new BadRequestException('Invalid product lifecycle transition');
  }
}

function priceView(price: ProductPrice) {
  return {
    id: price.id,
    amountMinor: price.amountMinor,
    currency: price.currency,
    effectiveFrom: price.effectiveFrom,
    effectiveTo: price.effectiveTo,
    createdAt: price.createdAt,
  };
}

function productView(
  product: ProductRow,
  currentPrice: ProductPrice | null,
  prices?: ProductPrice[],
) {
  return {
    id: product.id,
    storeId: product.storeId,
    name: product.name,
    description: product.description,
    lifecycle: product.lifecycle,
    menuVisible: product.menuVisible,
    priceId: currentPrice?.id ?? null,
    priceMinor: currentPrice?.amountMinor ?? null,
    currency: currentPrice?.currency ?? null,
    price: currentPrice ? priceView(currentPrice) : null,
    ...(prices ? { prices: prices.map(priceView) } : {}),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly storeManagementService: StoreManagementService,
  ) {}

  async browse(storeIdValue: unknown) {
    const store = await this.storeManagementService.getStore(storeIdValue);
    if (!isStoreOrderable(store)) {
      return { storeId: store.id, products: [] };
    }

    const rows = await this.listProductRows(store.id, true);
    return {
      storeId: store.id,
      products: rows.map((row) => productView(row.product, row.currentPrice)),
    };
  }

  async list(storeIdValue: unknown) {
    const store = await this.storeManagementService.getStore(storeIdValue);
    const rows = await this.listProductRows(store.id, false);
    return {
      storeId: store.id,
      products: rows.map((row) => productView(row.product, row.currentPrice)),
    };
  }

  async getProduct(storeIdValue: unknown, productIdValue: unknown) {
    const store = await this.storeManagementService.getStore(storeIdValue);
    const productId = this.normalizeProductId(productIdValue);
    const [product] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.storeId, store.id)))
      .limit(1);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const [currentPrice] = await this.db
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, product.id),
          isNull(productPrices.effectiveTo),
        ),
      )
      .limit(1);
    const current = currentPrice ?? null;
    const historicalPrices = await this.db
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, product.id),
          isNotNull(productPrices.effectiveTo),
        ),
      )
      .orderBy(desc(productPrices.effectiveFrom));
    const prices = [...(current ? [current] : []), ...historicalPrices];
    return productView(product, current, prices);
  }

  async getPriceHistory(storeIdValue: unknown, productIdValue: unknown) {
    const product = await this.getProduct(storeIdValue, productIdValue);
    return {
      storeId: product.storeId,
      productId: product.id,
      prices: product.prices,
    };
  }

  async createProduct(storeIdValue: unknown, input: CreateProductDto) {
    const store = await this.storeManagementService.getStore(storeIdValue);
    const body = (input ?? {}) as Record<string, unknown>;
    const name = requiredText(
      body.name,
      'product name',
      MAX_PRODUCT_NAME_LENGTH,
    );
    const description = normalizeDescription(body.description);
    const lifecycle =
      body.lifecycle === undefined
        ? 'DRAFT'
        : normalizeLifecycle(body.lifecycle);
    if (lifecycle === 'ARCHIVED') {
      throw new BadRequestException('A new product cannot be archived');
    }
    const menuVisible =
      body.menuVisible === undefined
        ? false
        : normalizeMenuVisible(body.menuVisible);
    const hasPrice = Object.prototype.hasOwnProperty.call(body, 'priceMinor');
    if (Object.prototype.hasOwnProperty.call(body, 'currency') && !hasPrice) {
      throw new BadRequestException(
        'A price amount is required when currency is provided',
      );
    }
    const amountMinor = hasPrice
      ? normalizeAmountMinor(body.priceMinor)
      : undefined;
    const currency = hasPrice
      ? normalizeCurrency(body.currency ?? 'USD')
      : undefined;

    try {
      const productId = await this.db.transaction(async (tx) => {
        const id = randomUUID();
        await tx.insert(products).values({
          id,
          storeId: store.id,
          name,
          description,
          lifecycle,
          menuVisible,
        });
        if (amountMinor !== undefined && currency !== undefined) {
          await tx.insert(productPrices).values({
            id: randomUUID(),
            productId: id,
            amountMinor,
            currency,
          });
        }
        return id;
      });
      return this.getProduct(store.id, productId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Product name already exists');
      }
      throw error;
    }
  }

  async updateProduct(
    storeIdValue: unknown,
    productIdValue: unknown,
    input: UpdateProductDto,
  ) {
    const store = await this.storeManagementService.getStore(storeIdValue);
    const productId = this.normalizeProductId(productIdValue);
    const body = (input ?? {}) as Record<string, unknown>;
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasDescription = Object.prototype.hasOwnProperty.call(
      body,
      'description',
    );
    const hasLifecycle = Object.prototype.hasOwnProperty.call(
      body,
      'lifecycle',
    );
    const hasMenuVisible = Object.prototype.hasOwnProperty.call(
      body,
      'menuVisible',
    );
    const hasPrice = Object.prototype.hasOwnProperty.call(body, 'priceMinor');
    const hasCurrency = Object.prototype.hasOwnProperty.call(body, 'currency');

    if (
      !hasName &&
      !hasDescription &&
      !hasLifecycle &&
      !hasMenuVisible &&
      !hasPrice &&
      !hasCurrency
    ) {
      throw new BadRequestException('At least one product field is required');
    }
    if (hasCurrency && !hasPrice) {
      throw new BadRequestException(
        'A price amount is required when currency is provided',
      );
    }

    try {
      await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(products)
          .where(
            and(eq(products.id, productId), eq(products.storeId, store.id)),
          )
          .limit(1);
        if (!current) {
          throw new NotFoundException('Product not found');
        }
        if (current.lifecycle === 'ARCHIVED') {
          throw new BadRequestException('Archived products cannot be changed');
        }

        const nextLifecycle = hasLifecycle
          ? normalizeLifecycle(body.lifecycle)
          : current.lifecycle;
        assertLifecycleTransition(current.lifecycle, nextLifecycle);
        const nextName = hasName
          ? requiredText(body.name, 'product name', MAX_PRODUCT_NAME_LENGTH)
          : current.name;
        const nextDescription = hasDescription
          ? normalizeDescription(body.description)
          : current.description;
        let nextMenuVisible = hasMenuVisible
          ? normalizeMenuVisible(body.menuVisible)
          : current.menuVisible;
        if (nextLifecycle === 'ARCHIVED') {
          nextMenuVisible = false;
        }

        const values: {
          name: string;
          description: string;
          lifecycle: ProductLifecycle;
          menuVisible: boolean;
          updatedAt: Date;
        } = {
          name: nextName,
          description: nextDescription,
          lifecycle: nextLifecycle,
          menuVisible: nextMenuVisible,
          updatedAt: new Date(),
        };
        await tx
          .update(products)
          .set(values)
          .where(eq(products.id, current.id));

        if (hasPrice) {
          const amountMinor = normalizeAmountMinor(body.priceMinor);
          const [currentPrice] = await tx
            .select()
            .from(productPrices)
            .where(
              and(
                eq(productPrices.productId, current.id),
                isNull(productPrices.effectiveTo),
              ),
            )
            .limit(1);
          const currency = normalizeCurrency(
            body.currency ?? currentPrice?.currency ?? 'USD',
          );
          const now = new Date();
          if (currentPrice) {
            await tx
              .update(productPrices)
              .set({ effectiveTo: now })
              .where(eq(productPrices.id, currentPrice.id));
          }
          await tx.insert(productPrices).values({
            id: randomUUID(),
            productId: current.id,
            amountMinor,
            currency,
            effectiveFrom: now,
          });
        }
      });
      return this.getProduct(store.id, productId);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw new ConflictException('Product name already exists');
      }
      throw error;
    }
  }

  async createPrice(
    storeIdValue: unknown,
    productIdValue: unknown,
    input: CreateProductPriceDto,
  ) {
    const store = await this.storeManagementService.getStore(storeIdValue);
    const productId = this.normalizeProductId(productIdValue);
    const body = (input ?? {}) as Record<string, unknown>;
    const amountMinor = normalizeAmountMinor(body.amountMinor);
    const currency = normalizeCurrency(body.currency ?? 'USD');

    try {
      await this.db.transaction(async (tx) => {
        const [product] = await tx
          .select({
            id: products.id,
            lifecycle: products.lifecycle,
          })
          .from(products)
          .where(
            and(eq(products.id, productId), eq(products.storeId, store.id)),
          )
          .limit(1);
        if (!product) {
          throw new NotFoundException('Product not found');
        }
        if (product.lifecycle === 'ARCHIVED') {
          throw new BadRequestException(
            'Archived products cannot receive prices',
          );
        }

        const [currentPrice] = await tx
          .select({ id: productPrices.id })
          .from(productPrices)
          .where(
            and(
              eq(productPrices.productId, product.id),
              isNull(productPrices.effectiveTo),
            ),
          )
          .limit(1);
        const now = new Date();
        if (currentPrice) {
          await tx
            .update(productPrices)
            .set({ effectiveTo: now })
            .where(eq(productPrices.id, currentPrice.id));
        }
        await tx.insert(productPrices).values({
          id: randomUUID(),
          productId: product.id,
          amountMinor,
          currency,
          effectiveFrom: now,
        });
      });
      return this.getProduct(store.id, productId);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw new ConflictException('Product price already exists');
      }
      throw error;
    }
  }

  private async listProductRows(storeId: string, visibleOnly: boolean) {
    const conditions = [eq(products.storeId, storeId)];
    if (visibleOnly) {
      conditions.push(
        eq(products.lifecycle, 'PUBLISHED'),
        eq(products.menuVisible, true),
        isNotNull(productPrices.id),
      );
    }

    const rows = await this.db
      .select({
        product: products,
        currentPrice: productPrices,
      })
      .from(products)
      .leftJoin(
        productPrices,
        and(
          eq(productPrices.productId, products.id),
          isNull(productPrices.effectiveTo),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(products.name));

    return rows as Array<{
      product: ProductRow;
      currentPrice: ProductPrice | null;
    }>;
  }

  private normalizeProductId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new BadRequestException('Invalid product ID');
    }
    return value;
  }
}

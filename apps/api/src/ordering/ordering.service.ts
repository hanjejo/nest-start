import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getCorrelationId } from '../observability/correlation-context';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  Order,
  OrderItem,
  orders,
  orderItems,
  productPrices,
  products,
  stores,
} from '../db/schema';
import { normalizeAddressSnapshot } from '../messaging/address-snapshot';
import { isStoreOrderable } from '../store-management/store-management.service';
import { RBAC_PERMISSIONS } from '../rbac/rbac.constants';
import { RbacService } from '../rbac/rbac.service';
import {
  createIntegrationEvent,
  IntegrationEventEnvelope,
} from '../messaging/integration-event';
import { DrizzleTransaction, OutboxService } from '../messaging/outbox.service';
import { CreateOrderDto } from './ordering.dto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MINOR_AMOUNT = 2_147_483_647;
const MAX_ORDER_ITEMS = 100;
const MAX_ITEM_QUANTITY = 1_000_000;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CANCELLABLE_STATUSES = ['AWAITING_PAYMENT', 'CONFIRMED'] as const;

type CreateOrderLine = {
  productId: string;
  quantity: number;
};

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function normalizeUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeQuantity(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_ITEM_QUANTITY
  ) {
    throw new BadRequestException('Invalid order quantity');
  }
  return value;
}

function normalizeCurrency(value: string): string {
  if (!CURRENCY_PATTERN.test(value)) {
    throw new BadRequestException('Invalid order currency');
  }
  return value;
}

function isCancellableStatus(
  status: Order['status'],
): status is (typeof CANCELLABLE_STATUSES)[number] {
  return CANCELLABLE_STATUSES.includes(
    status as (typeof CANCELLABLE_STATUSES)[number],
  );
}

function currentCorrelationId(): string {
  return getCorrelationId() ?? randomUUID();
}

@Injectable()
export class OrderingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly rbacService: RbacService,
    private readonly outboxService: OutboxService,
  ) {}

  async create(customerIdValue: string, input: CreateOrderDto) {
    const customerId = normalizeUuid(customerIdValue, 'customer ID');
    const body = asRecord(input);
    const storeId = normalizeUuid(body.storeId, 'store ID');
    const lines = this.normalizeLines(body.items);
    const addressSnapshot = normalizeAddressSnapshot(
      body.address ?? body.deliveryAddress ?? body.addressSnapshot,
    );
    const correlationId = currentCorrelationId();

    try {
      const orderId = await this.outboxService.transaction(async (tx) => {
        const [store] = await tx
          .select()
          .from(stores)
          .where(eq(stores.id, storeId))
          .limit(1);
        if (!store) {
          throw new NotFoundException('Store not found');
        }
        if (!isStoreOrderable(store)) {
          throw new BadRequestException('Store is not accepting orders');
        }

        const productRows = await tx
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
          .where(
            inArray(
              products.id,
              lines.map((line) => line.productId),
            ),
          )
          .orderBy(desc(productPrices.effectiveFrom));

        const productById = new Map<
          string,
          {
            product: (typeof productRows)[number]['product'];
            currentPrice: (typeof productRows)[number]['currentPrice'];
          }
        >();
        for (const row of productRows) {
          const existing = productById.get(row.product.id);
          if (
            !existing ||
            (!existing.currentPrice && row.currentPrice) ||
            (existing.currentPrice &&
              row.currentPrice &&
              row.currentPrice.effectiveFrom >
                existing.currentPrice.effectiveFrom)
          ) {
            productById.set(row.product.id, row);
          }
        }

        if (productById.size !== lines.length) {
          throw new BadRequestException(
            'One or more products are not available for ordering',
          );
        }

        const resolvedLines = lines.map((line) => {
          const resolved = productById.get(line.productId);
          if (!resolved || resolved.product.storeId !== storeId) {
            throw new BadRequestException(
              'All order products must belong to the requested store',
            );
          }
          if (
            resolved.product.lifecycle !== 'PUBLISHED' ||
            resolved.product.menuVisible !== true ||
            !resolved.currentPrice
          ) {
            throw new BadRequestException(
              'One or more products are not available for ordering',
            );
          }
          return {
            ...line,
            productName: resolved.product.name,
            unitAmountMinor: resolved.currentPrice.amountMinor,
            currency: normalizeCurrency(resolved.currentPrice.currency),
          };
        });

        const currency = resolvedLines[0]?.currency;
        if (!currency) {
          throw new BadRequestException('At least one order item is required');
        }
        if (resolvedLines.some((line) => line.currency !== currency)) {
          throw new BadRequestException(
            'All order products must use the same currency',
          );
        }

        let totalAmountMinor = 0;
        const snapshotLines = resolvedLines.map((line) => {
          if (
            line.unitAmountMinor > 0 &&
            line.quantity > Math.floor(MAX_MINOR_AMOUNT / line.unitAmountMinor)
          ) {
            throw new BadRequestException('Order amount is too large');
          }
          const lineAmountMinor = line.unitAmountMinor * line.quantity;
          totalAmountMinor += lineAmountMinor;
          if (totalAmountMinor > MAX_MINOR_AMOUNT) {
            throw new BadRequestException('Order amount is too large');
          }
          return {
            id: randomUUID(),
            productId: line.productId,
            productName: line.productName,
            unitAmountMinor: line.unitAmountMinor,
            currency: line.currency,
            quantity: line.quantity,
            lineAmountMinor,
          };
        });

        const id = randomUUID();
        const now = new Date();
        await tx.insert(orders).values({
          id,
          customerId,
          storeId,
          status: 'AWAITING_PAYMENT',
          currency,
          totalAmountMinor,
          addressSnapshot,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(orderItems).values(
          snapshotLines.map((line) => ({
            ...line,
            orderId: id,
          })),
        );

        await this.outboxService.enqueue(
          tx,
          createIntegrationEvent({
            eventType: 'OrderPlaced',
            eventVersion: 1,
            producer: 'Ordering',
            aggregateType: 'Order',
            aggregateId: id,
            aggregateVersion: 1,
            correlationId,
            causationId: null,
            idempotencyKey: `OrderPlaced:${id}`,
            occurredAt: now,
            payload: {
              orderId: id,
              storeId,
              customerId,
              orderAmount: totalAmountMinor,
              currency,
              addressSnapshot,
              lines: snapshotLines.map((line) => ({
                productId: line.productId,
                productName: line.productName,
                unitAmountMinor: line.unitAmountMinor,
                currency: line.currency,
                quantity: line.quantity,
                lineAmountMinor: line.lineAmountMinor,
              })),
            },
          }),
        );
        return id;
      });

      return this.getOrderView(orderId);
    } catch (error) {
      this.rethrow(error, 'Order creation failed');
    }
  }

  async list(userIdValue: string, storeIdValue: unknown = undefined) {
    const userId = normalizeUuid(userIdValue, 'user ID');

    try {
      if (storeIdValue !== undefined) {
        const storeId = normalizeUuid(storeIdValue, 'store ID');
        await this.assertPermission(
          userId,
          RBAC_PERMISSIONS.ORDER_READ_STORE,
          storeId,
        );
        return this.listViews(eq(orders.storeId, storeId));
      }

      if (
        await this.rbacService.hasPermission(
          userId,
          RBAC_PERMISSIONS.ORDER_READ_STORE,
        )
      ) {
        return this.listViews();
      }

      await this.assertPermission(userId, RBAC_PERMISSIONS.ORDER_READ_OWN);
      return this.listViews(eq(orders.customerId, userId));
    } catch (error) {
      this.rethrow(error, 'Order listing failed');
    }
  }

  async listForStore(userIdValue: string, storeIdValue: unknown) {
    return this.list(userIdValue, storeIdValue);
  }

  async get(userIdValue: string, orderIdValue: unknown) {
    const userId = normalizeUuid(userIdValue, 'user ID');
    const orderId = normalizeUuid(orderIdValue, 'order ID');

    try {
      const order = await this.findOrder(orderId);
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      await this.assertCanRead(userId, order);
      return this.getOrderView(order.id);
    } catch (error) {
      this.rethrow(error, 'Order lookup failed');
    }
  }

  async cancel(userIdValue: string, orderIdValue: unknown) {
    const userId = normalizeUuid(userIdValue, 'user ID');
    const orderId = normalizeUuid(orderIdValue, 'order ID');

    try {
      const existing = await this.findOrder(orderId);
      if (!existing) {
        throw new NotFoundException('Order not found');
      }
      await this.assertCanCancel(userId, existing);
      const correlationId = currentCorrelationId();

      await this.outboxService.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (!current) {
          throw new NotFoundException('Order not found');
        }
        if (current.status === 'CANCELLED') {
          return;
        }
        if (!isCancellableStatus(current.status)) {
          throw new BadRequestException(
            'Order cannot be cancelled after preparation begins',
          );
        }

        const cancelledAt = new Date();
        const [cancelled] = await tx
          .update(orders)
          .set({
            status: 'CANCELLED',
            cancelledAt,
            updatedAt: cancelledAt,
            aggregateVersion: sql`${orders.aggregateVersion} + 1`,
          })
          .where(
            and(
              eq(orders.id, orderId),
              inArray(orders.status, [...CANCELLABLE_STATUSES]),
            ),
          )
          .returning({
            id: orders.id,
            storeId: orders.storeId,
            aggregateVersion: orders.aggregateVersion,
          });
        if (cancelled) {
          await this.outboxService.enqueue(
            tx,
            createIntegrationEvent({
              eventType: 'OrderCancelled',
              eventVersion: 1,
              producer: 'Ordering',
              aggregateType: 'Order',
              aggregateId: cancelled.id,
              aggregateVersion: cancelled.aggregateVersion,
              correlationId,
              causationId: null,
              idempotencyKey: `OrderCancelled:${cancelled.id}`,
              occurredAt: cancelledAt,
              payload: {
                orderId: cancelled.id,
                storeId: cancelled.storeId,
                reason: 'CUSTOMER_REQUESTED',
                refundRequired: current.status === 'CONFIRMED',
              },
            }),
          );
          return;
        }

        const [latest] = await tx
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (latest?.status === 'CANCELLED') {
          return;
        }
        throw new BadRequestException(
          'Order cannot be cancelled after preparation begins',
        );
      });

      return this.getOrderView(orderId);
    } catch (error) {
      this.rethrow(error, 'Order cancellation failed');
    }
  }

  /**
   * Minimal internal seam for testing the cancellation preparation boundary.
   * Later preparation commands will own the full lifecycle transition.
   */
  async transitionToPreparingForTest(orderIdValue: unknown) {
    const orderId = normalizeUuid(orderIdValue, 'order ID');
    try {
      const [updated] = await this.db.transaction(async (tx) =>
        tx
          .update(orders)
          .set({
            status: 'PREPARING',
            updatedAt: new Date(),
            aggregateVersion: sql`${orders.aggregateVersion} + 1`,
          })
          .where(
            and(
              eq(orders.id, orderId),
              inArray(orders.status, [...CANCELLABLE_STATUSES]),
            ),
          )
          .returning({ id: orders.id }),
      );
      if (!updated) {
        const current = await this.findOrder(orderId);
        if (!current) {
          throw new NotFoundException('Order not found');
        }
        if (current.status === 'PREPARING') {
          return this.getOrderView(orderId);
        }
        throw new BadRequestException('Order is not awaiting preparation');
      }
      return this.getOrderView(orderId);
    } catch (error) {
      this.rethrow(error, 'Order status transition failed');
    }
  }

  async applyPaymentEvent(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<void> {
    const payload = event.payload;
    const orderId = payload.orderId;
    if (typeof orderId !== 'string') {
      throw new Error('Payment event has an invalid order ID');
    }

    const [current] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!current) {
      throw new Error(`Order ${orderId} was not found for Payment event`);
    }

    if (event.eventType === 'PaymentSucceeded') {
      if (
        typeof payload.storeId !== 'string' ||
        payload.storeId !== current.storeId
      ) {
        throw new Error('PaymentSucceeded store scope does not match Order');
      }
      if (current.status !== 'AWAITING_PAYMENT') {
        return;
      }

      const confirmedAt = new Date();
      const [confirmed] = await tx
        .update(orders)
        .set({
          status: 'CONFIRMED',
          aggregateVersion: sql`${orders.aggregateVersion} + 1`,
          updatedAt: confirmedAt,
        })
        .where(
          and(eq(orders.id, orderId), eq(orders.status, 'AWAITING_PAYMENT')),
        )
        .returning({
          id: orders.id,
          storeId: orders.storeId,
          customerId: orders.customerId,
          aggregateVersion: orders.aggregateVersion,
        });
      if (!confirmed) {
        return;
      }

      await this.outboxService.enqueue(
        tx,
        createIntegrationEvent({
          eventType: 'OrderConfirmed',
          eventVersion: 1,
          producer: 'Ordering',
          aggregateType: 'Order',
          aggregateId: confirmed.id,
          aggregateVersion: confirmed.aggregateVersion,
          correlationId: event.correlationId,
          causationId: event.eventId,
          idempotencyKey: `OrderConfirmed:${confirmed.id}`,
          occurredAt: confirmedAt,
          payload: {
            orderId: confirmed.id,
            storeId: confirmed.storeId,
            customerId: confirmed.customerId,
            addressSnapshot: current.addressSnapshot,
          },
        }),
      );
      return;
    }

    if (event.eventType === 'PaymentFailed' && payload.retryable === true) {
      return;
    }

    if (
      event.eventType !== 'PaymentFailed' &&
      event.eventType !== 'PaymentExpired'
    ) {
      return;
    }
    if (current.status !== 'AWAITING_PAYMENT') {
      return;
    }

    const cancelledAt = new Date();
    await tx
      .update(orders)
      .set({
        status: 'CANCELLED',
        cancelledAt,
        aggregateVersion: sql`${orders.aggregateVersion} + 1`,
        updatedAt: cancelledAt,
      })
      .where(
        and(eq(orders.id, orderId), eq(orders.status, 'AWAITING_PAYMENT')),
      );
  }

  private normalizeLines(value: unknown): CreateOrderLine[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('At least one order item is required');
    }
    if (value.length > MAX_ORDER_ITEMS) {
      throw new BadRequestException('Too many order items');
    }

    const productIds = new Set<string>();
    return value.map((rawLine) => {
      const line = asRecord(rawLine);
      const productId = normalizeUuid(line.productId, 'product ID');
      if (productIds.has(productId)) {
        throw new BadRequestException(
          'An order cannot contain duplicate products',
        );
      }
      productIds.add(productId);
      return {
        productId,
        quantity: normalizeQuantity(line.quantity),
      };
    });
  }

  private async findOrder(orderId: string): Promise<Order | undefined> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return order;
  }

  private async getOrderView(orderId: string) {
    const order = await this.findOrder(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    return this.orderView(order, items);
  }

  private async listViews(condition?: SQL) {
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(condition)
      .orderBy(desc(orders.createdAt), desc(orders.id));
    if (orderRows.length === 0) {
      return [];
    }

    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          orderRows.map((order) => order.id),
        ),
      );
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const item of itemRows) {
      const items = itemsByOrder.get(item.orderId) ?? [];
      items.push(item);
      itemsByOrder.set(item.orderId, items);
    }
    return orderRows.map((order) =>
      this.orderView(order, itemsByOrder.get(order.id) ?? []),
    );
  }

  private orderView(order: Order, items: OrderItem[]) {
    return {
      id: order.id,
      customerId: order.customerId,
      storeId: order.storeId,
      status: order.status,
      currency: order.currency,
      totalAmountMinor: order.totalAmountMinor,
      addressSnapshot: order.addressSnapshot,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        unitAmountMinor: item.unitAmountMinor,
        currency: item.currency,
        quantity: item.quantity,
        lineAmountMinor: item.lineAmountMinor,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
    };
  }

  private async assertCanRead(userId: string, order: Order): Promise<void> {
    if (
      order.customerId === userId &&
      (await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.ORDER_READ_OWN,
      ))
    ) {
      return;
    }
    await this.assertPermission(
      userId,
      RBAC_PERMISSIONS.ORDER_READ_STORE,
      order.storeId,
    );
  }

  private async assertCanCancel(userId: string, order: Order): Promise<void> {
    if (
      order.customerId === userId &&
      (await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.ORDER_CANCEL_OWN,
      ))
    ) {
      return;
    }
    await this.assertPermission(
      userId,
      RBAC_PERMISSIONS.ORDER_CANCEL_STORE,
      order.storeId,
    );
  }

  private async assertPermission(
    userId: string,
    permission: string,
    storeId?: string,
  ): Promise<void> {
    if (!(await this.rbacService.hasPermission(userId, permission, storeId))) {
      throw new ForbiddenException('Access denied');
    }
  }

  async startPreparation(userIdValue: string, orderIdValue: unknown) {
    const userId = normalizeUuid(userIdValue, 'user ID');
    const orderId = normalizeUuid(orderIdValue, 'order ID');

    try {
      const existing = await this.findOrder(orderId);
      if (!existing) {
        throw new NotFoundException('Order not found');
      }
      await this.assertPermission(
        userId,
        RBAC_PERMISSIONS.ORDER_CANCEL_STORE,
        existing.storeId,
      );

      await this.outboxService.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (!current) {
          throw new NotFoundException('Order not found');
        }
        if (
          current.status === 'PREPARING' ||
          current.status === 'READY_FOR_DELIVERY' ||
          current.status === 'DELIVERING' ||
          current.status === 'COMPLETED'
        ) {
          return;
        }
        if (current.status !== 'CONFIRMED') {
          throw new BadRequestException('Order is not ready for preparation');
        }

        const startedAt = new Date();
        const [started] = await tx
          .update(orders)
          .set({
            status: 'PREPARING',
            aggregateVersion: sql`${orders.aggregateVersion} + 1`,
            updatedAt: startedAt,
          })
          .where(and(eq(orders.id, orderId), eq(orders.status, 'CONFIRMED')))
          .returning({
            id: orders.id,
            storeId: orders.storeId,
            aggregateVersion: orders.aggregateVersion,
          });
        if (!started) {
          return;
        }

        await this.outboxService.enqueue(
          tx,
          createIntegrationEvent({
            eventType: 'OrderPreparationStarted',
            eventVersion: 1,
            producer: 'Ordering',
            aggregateType: 'Order',
            aggregateId: started.id,
            aggregateVersion: started.aggregateVersion,
            correlationId: currentCorrelationId(),
            causationId: null,
            idempotencyKey: `OrderPreparationStarted:${started.id}`,
            occurredAt: startedAt,
            payload: {
              orderId: started.id,
              storeId: started.storeId,
            },
          }),
        );
      });

      return this.getOrderView(orderId);
    } catch (error) {
      this.rethrow(error, 'Order preparation start failed');
    }
  }

  async markReadyForDelivery(userIdValue: string, orderIdValue: unknown) {
    const userId = normalizeUuid(userIdValue, 'user ID');
    const orderId = normalizeUuid(orderIdValue, 'order ID');

    try {
      const existing = await this.findOrder(orderId);
      if (!existing) {
        throw new NotFoundException('Order not found');
      }
      await this.assertPermission(
        userId,
        RBAC_PERMISSIONS.ORDER_CANCEL_STORE,
        existing.storeId,
      );

      await this.outboxService.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (!current) {
          throw new NotFoundException('Order not found');
        }
        if (
          current.status === 'READY_FOR_DELIVERY' ||
          current.status === 'DELIVERING' ||
          current.status === 'COMPLETED'
        ) {
          return;
        }
        if (current.status !== 'PREPARING') {
          throw new BadRequestException('Order is not being prepared');
        }

        const readyAt = new Date();
        const [ready] = await tx
          .update(orders)
          .set({
            status: 'READY_FOR_DELIVERY',
            aggregateVersion: sql`${orders.aggregateVersion} + 1`,
            updatedAt: readyAt,
          })
          .where(and(eq(orders.id, orderId), eq(orders.status, 'PREPARING')))
          .returning({
            id: orders.id,
            storeId: orders.storeId,
            aggregateVersion: orders.aggregateVersion,
          });
        if (!ready) {
          return;
        }

        await this.outboxService.enqueue(
          tx,
          createIntegrationEvent({
            eventType: 'OrderReadyForDelivery',
            eventVersion: 1,
            producer: 'Ordering',
            aggregateType: 'Order',
            aggregateId: ready.id,
            aggregateVersion: ready.aggregateVersion,
            correlationId: currentCorrelationId(),
            causationId: null,
            idempotencyKey: `OrderReadyForDelivery:${ready.id}`,
            occurredAt: readyAt,
            payload: {
              orderId: ready.id,
              storeId: ready.storeId,
            },
          }),
        );
      });

      return this.getOrderView(orderId);
    } catch (error) {
      this.rethrow(error, 'Order ready transition failed');
    }
  }

  async applyDeliveryEvent(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<void> {
    const payload = event.payload;
    const orderId = payload.orderId;
    const storeId = payload.storeId;
    if (typeof orderId !== 'string' || typeof storeId !== 'string') {
      throw new Error('Delivery event has an invalid order or store ID');
    }

    const [current] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!current) {
      throw new Error(`Order ${orderId} was not found for Delivery event`);
    }
    if (current.storeId !== storeId) {
      throw new Error('Delivery event store scope does not match Order');
    }

    if (event.eventType === 'DeliveryCreated') {
      return;
    }

    if (event.eventType === 'DeliveryStarted') {
      if (current.status === 'DELIVERING' || current.status === 'COMPLETED') {
        return;
      }
      if (current.status !== 'READY_FOR_DELIVERY') {
        throw new Error('DeliveryStarted cannot advance this Order');
      }
      await tx
        .update(orders)
        .set({
          status: 'DELIVERING',
          aggregateVersion: sql`${orders.aggregateVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(orders.id, orderId), eq(orders.status, 'READY_FOR_DELIVERY')),
        );
      return;
    }

    if (event.eventType === 'DeliveryCompleted') {
      if (current.status === 'COMPLETED') {
        return;
      }
      if (
        current.status !== 'DELIVERING' &&
        current.status !== 'READY_FOR_DELIVERY'
      ) {
        throw new Error('DeliveryCompleted cannot advance this Order');
      }
      await tx
        .update(orders)
        .set({
          status: 'COMPLETED',
          aggregateVersion: sql`${orders.aggregateVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, orderId),
            inArray(orders.status, ['DELIVERING', 'READY_FOR_DELIVERY']),
          ),
        );
      return;
    }

    if (event.eventType === 'DeliveryFailed') {
      // Delivery owns failure state. Ordering deliberately leaves the Order
      // READY_FOR_DELIVERY so an authorized operator can retry the Delivery.
      return;
    }

    throw new Error(`Unsupported Delivery event ${event.eventType}`);
  }

  private rethrow(error: unknown, fallbackMessage: string): never {
    if (error instanceof HttpException) {
      throw error;
    }
    throw new InternalServerErrorException(fallbackMessage);
  }
}

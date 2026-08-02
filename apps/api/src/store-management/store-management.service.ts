import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  OperatingHours,
  Store,
  StorePolicies,
  StoreStatus,
  StoreWeekday,
  storeStatuses,
  storeWeekdays,
  stores,
} from '../db/schema';
import { UpdateStoreOperationsDto } from './store-management.dto';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const MAX_INTERVALS_PER_DAY = 4;

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  sunday: [],
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
};

export const DEFAULT_STORE_POLICIES: StorePolicies = {
  acceptingOrders: true,
};

type StoreOperationalFields = Pick<
  Store,
  'status' | 'operatingHours' | 'policies'
>;

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function normalizeUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return (value as T | undefined) ?? fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseTime(value: unknown, field: string): number {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  if (value === '24:00') {
    return 24 * 60;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function cloneHours(hours: OperatingHours): OperatingHours {
  return Object.fromEntries(
    storeWeekdays.map((day) => [
      day,
      hours[day].map((interval) => ({ ...interval })),
    ]),
  ) as OperatingHours;
}

function normalizeStoredHours(value: unknown): OperatingHours {
  if (!isRecord(value)) {
    return cloneHours(DEFAULT_OPERATING_HOURS);
  }

  const result = cloneHours(DEFAULT_OPERATING_HOURS);
  for (const day of storeWeekdays) {
    const rawIntervals = value[day];
    if (!Array.isArray(rawIntervals)) {
      continue;
    }
    result[day] = rawIntervals.filter(isRecord).flatMap((interval) => {
      if (
        typeof interval.open !== 'string' ||
        typeof interval.close !== 'string'
      ) {
        return [];
      }
      return [{ open: interval.open, close: interval.close }];
    });
  }
  return result;
}

function normalizeOperatingHours(
  value: unknown,
  current: OperatingHours,
): OperatingHours {
  if (!isRecord(value)) {
    throw new BadRequestException('Invalid operating hours');
  }

  const result = cloneHours(current);
  for (const key of Object.keys(value)) {
    if (!storeWeekdays.includes(key as StoreWeekday)) {
      throw new BadRequestException('Invalid operating hours day');
    }
  }

  for (const day of storeWeekdays) {
    if (!(day in value)) {
      continue;
    }

    const raw = value[day];
    const intervals = Array.isArray(raw)
      ? raw
      : isRecord(raw)
        ? [raw]
        : undefined;
    if (!intervals || intervals.length > MAX_INTERVALS_PER_DAY) {
      throw new BadRequestException(`Invalid ${day} operating hours`);
    }

    const normalized = intervals.map((interval, index) => {
      if (!isRecord(interval)) {
        throw new BadRequestException(`Invalid ${day} operating hours`);
      }
      const openMinutes = parseTime(
        interval.open,
        `${day} interval ${index + 1} opening time`,
      );
      const closeMinutes = parseTime(
        interval.close,
        `${day} interval ${index + 1} closing time`,
      );
      if (openMinutes >= closeMinutes) {
        throw new BadRequestException(
          `Invalid ${day} operating hours interval`,
        );
      }
      return {
        open: interval.open as string,
        close: interval.close as string,
        openMinutes,
        closeMinutes,
      };
    });

    normalized.sort((left, right) => left.openMinutes - right.openMinutes);
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index].openMinutes < normalized[index - 1].closeMinutes) {
        throw new BadRequestException(
          `Overlapping ${day} operating hours intervals`,
        );
      }
    }

    result[day] = normalized.map(({ open, close }) => ({ open, close }));
  }
  return result;
}

function normalizePolicies(
  value: unknown,
  current: StorePolicies,
): StorePolicies {
  if (!isRecord(value) || typeof value.acceptingOrders !== 'boolean') {
    throw new BadRequestException('Invalid store policies');
  }
  return { ...current, acceptingOrders: value.acceptingOrders };
}

function normalizeStatus(value: unknown): StoreStatus {
  if (
    typeof value !== 'string' ||
    !storeStatuses.includes(value as StoreStatus)
  ) {
    throw new BadRequestException('Invalid store status');
  }
  return value as StoreStatus;
}

function assertStatusTransition(current: StoreStatus, next: StoreStatus): void {
  if (current === next) {
    return;
  }

  const allowed: Record<StoreStatus, StoreStatus[]> = {
    DRAFT: ['OPEN'],
    OPEN: ['CLOSED', 'SUSPENDED'],
    CLOSED: ['OPEN', 'SUSPENDED'],
    SUSPENDED: ['OPEN', 'CLOSED'],
  };
  if (!allowed[current].includes(next)) {
    throw new BadRequestException('Invalid store status transition');
  }
}

export function isStoreOrderable(
  store: StoreOperationalFields,
  now = new Date(),
): boolean {
  if (store.status !== 'OPEN') {
    return false;
  }

  const policies = jsonValue<StorePolicies>(
    store.policies,
    DEFAULT_STORE_POLICIES,
  );
  if (policies.acceptingOrders !== true) {
    return false;
  }

  const hours = normalizeStoredHours(store.operatingHours);
  const day = storeWeekdays[now.getUTCDay()];
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return hours[day].some((interval) => {
    const openMinutes = parseTime(interval.open, 'stored opening time');
    const closeMinutes = parseTime(interval.close, 'stored closing time');
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  });
}

@Injectable()
export class StoreManagementService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async getStore(storeIdValue: unknown): Promise<Store> {
    const storeId = normalizeUuid(storeIdValue, 'store ID');
    const [store] = await this.db
      .select()
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  async getOperations(storeIdValue: unknown) {
    const store = await this.getStore(storeIdValue);
    return this.operationsView(store);
  }

  async updateOperations(
    storeIdValue: unknown,
    input: UpdateStoreOperationsDto,
  ) {
    const storeId = normalizeUuid(storeIdValue, 'store ID');
    const body = (input ?? {}) as Record<string, unknown>;
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasHours = Object.prototype.hasOwnProperty.call(
      body,
      'operatingHours',
    );
    const hasPolicies = Object.prototype.hasOwnProperty.call(body, 'policies');
    const hasAcceptingOrders = Object.prototype.hasOwnProperty.call(
      body,
      'acceptingOrders',
    );

    if (!hasStatus && !hasHours && !hasPolicies && !hasAcceptingOrders) {
      throw new BadRequestException('At least one store operation is required');
    }

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(stores)
        .where(eq(stores.id, storeId))
        .limit(1);
      if (!current) {
        throw new NotFoundException('Store not found');
      }

      const currentHours = normalizeStoredHours(current.operatingHours);
      const currentPolicies = jsonValue<StorePolicies>(
        current.policies,
        DEFAULT_STORE_POLICIES,
      );
      const status = hasStatus ? normalizeStatus(body.status) : current.status;
      assertStatusTransition(current.status, status);

      const operatingHours = hasHours
        ? normalizeOperatingHours(body.operatingHours, currentHours)
        : currentHours;

      let policies = currentPolicies;
      if (hasPolicies) {
        policies = normalizePolicies(body.policies, policies);
      }
      if (hasAcceptingOrders) {
        if (typeof body.acceptingOrders !== 'boolean') {
          throw new BadRequestException('Invalid acceptingOrders policy');
        }
        policies = {
          ...policies,
          acceptingOrders: body.acceptingOrders,
        };
      }

      const [updated] = await tx
        .update(stores)
        .set({
          status,
          operatingHours,
          policies,
          updatedAt: new Date(),
        })
        .where(eq(stores.id, storeId))
        .returning();
      if (!updated) {
        throw new NotFoundException('Store not found');
      }
      return this.operationsView(updated);
    });
  }

  private operationsView(store: Store) {
    const operatingHours = normalizeStoredHours(store.operatingHours);
    const policies = jsonValue<StorePolicies>(
      store.policies,
      DEFAULT_STORE_POLICIES,
    );
    return {
      storeId: store.id,
      name: store.name,
      status: store.status,
      timezone: 'UTC',
      operatingHours,
      policies,
      orderable: isStoreOrderable({
        status: store.status,
        operatingHours,
        policies,
      }),
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
    };
  }
}

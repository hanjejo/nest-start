import type { OperatingHours, StorePolicies, StoreStatus } from '../db/schema';

export class UpdateStoreOperationsDto {
  status?: StoreStatus;
  operatingHours?: OperatingHours;
  policies?: StorePolicies;
  acceptingOrders?: boolean;
}

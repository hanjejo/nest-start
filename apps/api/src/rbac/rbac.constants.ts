export const RBAC_ROLES = {
  CUSTOMER: 'customer',
  STORE_OPERATOR: 'store-operator',
  STORE_ADMIN: 'store-admin',
  PLATFORM_ADMIN: 'platform-admin',
} as const;

export const RBAC_PERMISSIONS = {
  STORE_DIRECTORY_READ: 'store.directory.read',
  ORDER_CREATE: 'order.create',
  ORDER_READ_OWN: 'order.read.own',
  ORDER_READ_STORE: 'order.read.store',
  ORDER_CANCEL_OWN: 'order.cancel.own',
  ORDER_CANCEL_STORE: 'order.cancel.store',
  PAYMENT_READ_OWN: 'payment.read.own',
  PAYMENT_READ_STORE: 'payment.read.store',
  PAYMENT_ATTEMPT_OWN: 'payment.attempt.own',
  SETTLEMENT_READ_STORE: 'settlement.read.store',
  STORE_SCOPE_READ: 'store.scope.read',
  STORE_SCOPE_MANAGE: 'store.scope.manage',
  CATALOG_READ: 'catalog.read',
  CATALOG_MANAGE: 'catalog.manage',
  STORE_OPERATIONS_MANAGE: 'store.operations.manage',
  RBAC_CATALOG_READ: 'rbac.catalog.read',
  RBAC_CATALOG_WRITE: 'rbac.catalog.write',
  RBAC_ASSIGNMENT_READ: 'rbac.assignment.read',
  RBAC_ASSIGNMENT_WRITE: 'rbac.assignment.write',
} as const;

export type RbacPermissionKey =
  (typeof RBAC_PERMISSIONS)[keyof typeof RBAC_PERMISSIONS];

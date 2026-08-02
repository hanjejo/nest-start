import type { PermissionScope, RoleAssignmentScope } from '../db/schema';

export class CreateRoleDto {
  name!: string;
  description!: string;
  assignmentScope?: RoleAssignmentScope;
  globalStoreAccess?: boolean;
}

export class CreatePermissionDto {
  key!: string;
  description!: string;
  scope?: PermissionScope;
}

export class CreateRolePermissionDto {
  roleId?: string;
  role?: string;
  permissionId?: string;
  permission?: string;
}

export class CreateStoreDto {
  id?: string;
  name!: string;
}

export class CreateAssignmentDto {
  userId!: string;
  roleId?: string;
  role?: string;
  storeId?: string;
}

export class BootstrapDto {
  userId!: string;
}

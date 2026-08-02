import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  stores,
  users,
} from '../db/schema';
import {
  CreateAssignmentDto,
  CreatePermissionDto,
  CreateRoleDto,
  CreateRolePermissionDto,
  CreateStoreDto,
} from './rbac.dto';
import { RBAC_PERMISSIONS, RBAC_ROLES } from './rbac.constants';

const MAX_ROLE_NAME_LENGTH = 64;
const MAX_PERMISSION_KEY_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_STORE_NAME_LENGTH = 200;
const BOOTSTRAP_UNAVAILABLE_MESSAGE = 'RBAC bootstrap unavailable';

type AssignmentFilters = {
  userId?: string;
  storeId?: string;
  roleId?: string;
  role?: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
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

function normalizeRoleName(value: unknown): string {
  const name = requiredText(
    value,
    'role name',
    MAX_ROLE_NAME_LENGTH,
  ).toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new BadRequestException('Invalid role name');
  }
  return name;
}

function normalizePermissionKey(value: unknown): string {
  const key = requiredText(
    value,
    'permission key',
    MAX_PERMISSION_KEY_LENGTH,
  ).toLowerCase();
  if (!/^[a-z][a-z0-9._:-]*$/.test(key)) {
    throw new BadRequestException('Invalid permission key');
  }
  return key;
}

function normalizeScope(
  value: unknown,
  fallback: 'GLOBAL' | 'STORE',
): 'GLOBAL' | 'STORE' {
  const scope = value ?? fallback;
  if (scope !== 'GLOBAL' && scope !== 'STORE') {
    throw new BadRequestException('Invalid scope');
  }
  return scope;
}

function normalizeUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value;
}

function safeTokenMatches(
  configuredToken: string | undefined,
  presentedToken: unknown,
): boolean {
  if (
    typeof configuredToken !== 'string' ||
    typeof presentedToken !== 'string'
  ) {
    return false;
  }

  const configured = Buffer.from(configuredToken, 'utf8');
  const presented = Buffer.from(presentedToken, 'utf8');
  return (
    configured.length === presented.length &&
    timingSafeEqual(configured, presented)
  );
}

@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async listRoles() {
    const roleRows = await this.db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        assignmentScope: roles.assignmentScope,
        globalStoreAccess: roles.globalStoreAccess,
        system: roles.system,
        createdAt: roles.createdAt,
      })
      .from(roles)
      .orderBy(asc(roles.name));
    const permissionRows = await this.db
      .select({
        roleId: rolePermissions.roleId,
        id: permissions.id,
        key: permissions.key,
        description: permissions.description,
        scope: permissions.scope,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .orderBy(asc(permissions.key));

    const permissionsByRole = new Map<
      string,
      Array<{
        id: string;
        key: string;
        description: string;
        scope: string;
      }>
    >();
    for (const permission of permissionRows) {
      const rolePermissionsForRole =
        permissionsByRole.get(permission.roleId) ?? [];
      rolePermissionsForRole.push({
        id: permission.id,
        key: permission.key,
        description: permission.description,
        scope: permission.scope,
      });
      permissionsByRole.set(permission.roleId, rolePermissionsForRole);
    }

    return roleRows.map((role) => ({
      ...role,
      permissions: permissionsByRole.get(role.id) ?? [],
    }));
  }

  async listPermissions() {
    return this.db
      .select({
        id: permissions.id,
        key: permissions.key,
        description: permissions.description,
        scope: permissions.scope,
        system: permissions.system,
        createdAt: permissions.createdAt,
      })
      .from(permissions)
      .orderBy(asc(permissions.key));
  }

  async listStores() {
    return this.db
      .select({
        id: stores.id,
        name: stores.name,
        createdAt: stores.createdAt,
      })
      .from(stores)
      .orderBy(asc(stores.name));
  }

  async listAssignments(filters: AssignmentFilters = {}) {
    const conditions = [];
    if (filters.userId !== undefined) {
      conditions.push(
        eq(roleAssignments.userId, normalizeUuid(filters.userId, 'user ID')),
      );
    }
    if (filters.storeId !== undefined) {
      conditions.push(
        eq(roleAssignments.storeId, normalizeUuid(filters.storeId, 'store ID')),
      );
    }
    if (filters.roleId !== undefined) {
      conditions.push(
        eq(roleAssignments.roleId, normalizeUuid(filters.roleId, 'role ID')),
      );
    }
    if (filters.role !== undefined) {
      conditions.push(eq(roles.name, normalizeRoleName(filters.role)));
    }

    const rows = await this.db
      .select({
        id: roleAssignments.id,
        userId: roleAssignments.userId,
        roleId: roles.id,
        roleName: roles.name,
        roleDescription: roles.description,
        assignmentScope: roles.assignmentScope,
        globalStoreAccess: roles.globalStoreAccess,
        storeId: stores.id,
        storeName: stores.name,
        createdAt: roleAssignments.createdAt,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .leftJoin(stores, eq(roleAssignments.storeId, stores.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(roleAssignments.createdAt));

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: {
        id: row.roleId,
        name: row.roleName,
        description: row.roleDescription,
        assignmentScope: row.assignmentScope,
        globalStoreAccess: row.globalStoreAccess,
      },
      store: row.storeId
        ? {
            id: row.storeId,
            name: row.storeName,
          }
        : null,
      createdAt: row.createdAt,
    }));
  }

  async createRole(input: CreateRoleDto) {
    const name = normalizeRoleName(input?.name);
    const description = requiredText(
      input?.description,
      'role description',
      MAX_DESCRIPTION_LENGTH,
    );
    const assignmentScope = normalizeScope(input?.assignmentScope, 'STORE');

    if (input?.globalStoreAccess === true) {
      throw new BadRequestException(
        'Global store access is reserved for the platform administrator role',
      );
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [role] = await tx
          .insert(roles)
          .values({
            id: randomUUID(),
            name,
            description,
            assignmentScope,
            globalStoreAccess: false,
            system: false,
          })
          .returning({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            assignmentScope: roles.assignmentScope,
            globalStoreAccess: roles.globalStoreAccess,
            system: roles.system,
            createdAt: roles.createdAt,
          });

        if (!role) {
          throw new Error('Role was not created');
        }
        return { ...role, permissions: [] };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Role already exists');
      }
      throw new InternalServerErrorException('Role creation failed');
    }
  }

  async createPermission(input: CreatePermissionDto) {
    const key = normalizePermissionKey(input?.key);
    const description = requiredText(
      input?.description,
      'permission description',
      MAX_DESCRIPTION_LENGTH,
    );
    const scope = normalizeScope(input?.scope, 'GLOBAL');

    try {
      return await this.db.transaction(async (tx) => {
        const [permission] = await tx
          .insert(permissions)
          .values({
            id: randomUUID(),
            key,
            description,
            scope,
            system: false,
          })
          .returning({
            id: permissions.id,
            key: permissions.key,
            description: permissions.description,
            scope: permissions.scope,
            system: permissions.system,
            createdAt: permissions.createdAt,
          });

        if (!permission) {
          throw new Error('Permission was not created');
        }
        return permission;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Permission already exists');
      }
      throw new InternalServerErrorException('Permission creation failed');
    }
  }

  async createRolePermission(input: CreateRolePermissionDto) {
    const roleId = input?.roleId
      ? normalizeUuid(input.roleId, 'role ID')
      : undefined;
    const roleName = input?.role ? normalizeRoleName(input.role) : undefined;
    const permissionId = input?.permissionId
      ? normalizeUuid(input.permissionId, 'permission ID')
      : undefined;
    const permissionKey = input?.permission
      ? normalizePermissionKey(input.permission)
      : undefined;

    if ((!roleId && !roleName) || (!permissionId && !permissionKey)) {
      throw new BadRequestException(
        'A role and permission identifier are required',
      );
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [role] = await tx
          .select({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            assignmentScope: roles.assignmentScope,
            globalStoreAccess: roles.globalStoreAccess,
          })
          .from(roles)
          .where(roleId ? eq(roles.id, roleId) : eq(roles.name, roleName ?? ''))
          .limit(1);
        if (!role) {
          throw new NotFoundException('Role not found');
        }

        const [permission] = await tx
          .select({
            id: permissions.id,
            key: permissions.key,
            description: permissions.description,
            scope: permissions.scope,
          })
          .from(permissions)
          .where(
            permissionId
              ? eq(permissions.id, permissionId)
              : eq(permissions.key, permissionKey ?? ''),
          )
          .limit(1);
        if (!permission) {
          throw new NotFoundException('Permission not found');
        }

        this.assertPermissionCanBeAssigned(role, permission.scope);

        const [existing] = await tx
          .select({ roleId: rolePermissions.roleId })
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, role.id),
              eq(rolePermissions.permissionId, permission.id),
            ),
          )
          .limit(1);
        if (existing) {
          return { role, permission };
        }

        await tx.insert(rolePermissions).values({
          roleId: role.id,
          permissionId: permission.id,
        });
        return { role, permission };
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        return this.createRolePermission(input);
      }
      throw new InternalServerErrorException('Role permission creation failed');
    }
  }

  async createStore(input: CreateStoreDto) {
    const name = requiredText(input?.name, 'store name', MAX_STORE_NAME_LENGTH);
    const id = input?.id ? normalizeUuid(input.id, 'store ID') : randomUUID();

    try {
      return await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: stores.id,
            name: stores.name,
            createdAt: stores.createdAt,
          })
          .from(stores)
          .where(eq(stores.name, name))
          .limit(1);
        if (existing) {
          return existing;
        }

        const [store] = await tx.insert(stores).values({ id, name }).returning({
          id: stores.id,
          name: stores.name,
          createdAt: stores.createdAt,
        });
        if (!store) {
          throw new Error('Store was not created');
        }
        return store;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Store already exists');
      }
      throw new InternalServerErrorException('Store creation failed');
    }
  }

  async createAssignment(input: CreateAssignmentDto) {
    const userId = normalizeUuid(input?.userId, 'user ID');
    const roleId = input?.roleId
      ? normalizeUuid(input.roleId, 'role ID')
      : undefined;
    const roleName = input?.role ? normalizeRoleName(input.role) : undefined;
    const storeId = input?.storeId
      ? normalizeUuid(input.storeId, 'store ID')
      : undefined;

    if (!roleId && !roleName) {
      throw new BadRequestException('A role identifier is required');
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          throw new NotFoundException('User not found');
        }

        const [role] = await tx
          .select({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            assignmentScope: roles.assignmentScope,
            globalStoreAccess: roles.globalStoreAccess,
          })
          .from(roles)
          .where(roleId ? eq(roles.id, roleId) : eq(roles.name, roleName ?? ''))
          .limit(1);
        if (!role) {
          throw new NotFoundException('Role not found');
        }

        if (role.assignmentScope === 'STORE' && !storeId) {
          throw new BadRequestException(
            'A store ID is required for a store-scoped role',
          );
        }
        if (role.assignmentScope === 'GLOBAL' && storeId) {
          throw new BadRequestException(
            'A global role cannot be assigned to a store',
          );
        }

        let store: { id: string; name: string; createdAt: Date } | undefined;
        if (storeId) {
          [store] = await tx
            .select({
              id: stores.id,
              name: stores.name,
              createdAt: stores.createdAt,
            })
            .from(stores)
            .where(eq(stores.id, storeId))
            .limit(1);
          if (!store) {
            throw new NotFoundException('Store not found');
          }
        }

        const existingConditions = [
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.roleId, role.id),
          storeId
            ? eq(roleAssignments.storeId, storeId)
            : isNull(roleAssignments.storeId),
        ];
        const [existing] = await tx
          .select({ id: roleAssignments.id })
          .from(roleAssignments)
          .where(and(...existingConditions))
          .limit(1);
        if (existing) {
          return this.assignmentView(
            existing.id,
            userId,
            role,
            store,
            undefined,
          );
        }

        const [assignment] = await tx
          .insert(roleAssignments)
          .values({
            id: randomUUID(),
            userId,
            roleId: role.id,
            storeId: storeId ?? null,
          })
          .returning({
            id: roleAssignments.id,
            createdAt: roleAssignments.createdAt,
          });
        if (!assignment) {
          throw new Error('Assignment was not created');
        }

        return this.assignmentView(
          assignment.id,
          userId,
          role,
          store,
          assignment.createdAt,
        );
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        const [existing] = await this.listAssignments({
          userId,
          storeId,
          roleId,
          role: roleName,
        });
        if (existing) {
          return existing;
        }
      }
      throw new InternalServerErrorException('Assignment creation failed');
    }
  }

  async hasPermission(
    userId: string,
    permissionKey: string,
    storeId?: string,
  ): Promise<boolean> {
    if (!isUuid(userId)) {
      return false;
    }

    const rows = await this.db
      .select({
        assignmentScope: roles.assignmentScope,
        globalStoreAccess: roles.globalStoreAccess,
        assignmentStoreId: roleAssignments.storeId,
        permissionScope: permissions.scope,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(
        rolePermissions,
        eq(roleAssignments.roleId, rolePermissions.roleId),
      )
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(permissions.key, permissionKey),
        ),
      );

    return rows.some((row) => {
      if (row.permissionScope === 'GLOBAL') {
        return (
          row.assignmentScope === 'GLOBAL' && row.assignmentStoreId === null
        );
      }

      if (row.globalStoreAccess && row.assignmentScope === 'GLOBAL') {
        return row.assignmentStoreId === null;
      }

      return (
        row.assignmentScope === 'STORE' &&
        typeof storeId === 'string' &&
        row.assignmentStoreId === storeId
      );
    });
  }

  async bootstrap(userIdValue: unknown, presentedToken: unknown) {
    const configuredToken = process.env.RBAC_BOOTSTRAP_TOKEN?.trim();
    const productionBootstrapEnabled =
      process.env.NODE_ENV !== 'production' ||
      process.env.RBAC_BOOTSTRAP_ENABLED === 'true';
    if (
      !configuredToken ||
      !productionBootstrapEnabled ||
      !safeTokenMatches(configuredToken, presentedToken)
    ) {
      throw new ForbiddenException(BOOTSTRAP_UNAVAILABLE_MESSAGE);
    }

    const userId = normalizeUuid(userIdValue, 'user ID');

    try {
      return await this.db.transaction(async (tx) => {
        const [existingPlatformAdmin] = await tx
          .select({ id: roleAssignments.id })
          .from(roleAssignments)
          .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
          .where(eq(roles.globalStoreAccess, true))
          .limit(1);
        if (existingPlatformAdmin) {
          throw new ConflictException('RBAC bootstrap already completed');
        }

        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          throw new NotFoundException('User not found');
        }

        const [platformAdminRole] = await tx
          .select({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            assignmentScope: roles.assignmentScope,
            globalStoreAccess: roles.globalStoreAccess,
          })
          .from(roles)
          .where(eq(roles.name, RBAC_ROLES.PLATFORM_ADMIN))
          .limit(1);
        if (!platformAdminRole) {
          throw new InternalServerErrorException(
            'Platform administrator role is unavailable',
          );
        }

        const [assignment] = await tx
          .insert(roleAssignments)
          .values({
            id: randomUUID(),
            userId,
            roleId: platformAdminRole.id,
            storeId: null,
          })
          .returning({
            id: roleAssignments.id,
            createdAt: roleAssignments.createdAt,
          });
        if (!assignment) {
          throw new Error('Bootstrap assignment was not created');
        }

        return {
          id: assignment.id,
          userId,
          role: platformAdminRole,
          store: null,
          createdAt: assignment.createdAt,
        };
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw new ConflictException('RBAC bootstrap already completed');
      }
      throw new InternalServerErrorException('RBAC bootstrap failed');
    }
  }

  async getStoreCapability(storeIdValue: unknown, userId: string) {
    const storeId = normalizeUuid(storeIdValue, 'store ID');
    const [store] = await this.db
      .select({
        id: stores.id,
        name: stores.name,
      })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return {
      storeId: store.id,
      storeName: store.name,
      userId,
      permission: RBAC_PERMISSIONS.STORE_SCOPE_READ,
      access: 'granted',
    };
  }

  private assertPermissionCanBeAssigned(
    role: {
      assignmentScope: string;
      globalStoreAccess: boolean;
    },
    permissionScope: string,
  ): void {
    if (permissionScope === 'GLOBAL' && role.assignmentScope !== 'GLOBAL') {
      throw new BadRequestException('Global permissions require a global role');
    }
    if (
      permissionScope === 'STORE' &&
      role.assignmentScope !== 'STORE' &&
      !role.globalStoreAccess
    ) {
      throw new BadRequestException(
        'Store permissions require a store role or global store access',
      );
    }
  }

  private assignmentView(
    id: string,
    userId: string,
    role: {
      id: string;
      name: string;
      description: string;
      assignmentScope: string;
      globalStoreAccess: boolean;
    },
    store:
      | {
          id: string;
          name: string;
          createdAt: Date;
        }
      | undefined,
    createdAt: Date | undefined,
  ) {
    return {
      id,
      userId,
      role,
      store: store
        ? {
            id: store.id,
            name: store.name,
          }
        : null,
      ...(createdAt ? { createdAt } : {}),
    };
  }
}

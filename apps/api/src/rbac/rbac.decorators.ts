import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_METADATA = 'rbac:required-permission';

export type PermissionRequirement = {
  permission: string;
  storeIdParam?: string;
};

export function RequirePermission(
  permission: string,
  options: Omit<PermissionRequirement, 'permission'> = {},
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_PERMISSION_METADATA, {
    permission,
    ...options,
  });
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  AuthenticatedRequest,
} from './access-token.guard';
import {
  PermissionRequirement,
  REQUIRED_PERMISSION_METADATA,
} from './rbac.decorators';
import { RbacService } from './rbac.service';

export const ACCESS_DENIED_MESSAGE = 'Access denied';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSION_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }

    const storeId = requirement.storeIdParam
      ? request.params?.[requirement.storeIdParam]
      : undefined;
    const hasPermission = await this.rbacService.hasPermission(
      user.sub,
      requirement.permission,
      storeId,
    );

    if (!hasPermission) {
      throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
    }

    return true;
  }
}

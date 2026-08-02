import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenClaims } from '../identity-and-access/access-token.service';
import { AuthService } from '../identity-and-access/auth.service';

export const AUTHENTICATION_REQUIRED_MESSAGE = 'Authentication required';

export type AuthenticatedRequest = Request & {
  user?: AccessTokenClaims;
};

function accessTokenFromRequest(request: Request): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1];
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = accessTokenFromRequest(request);

    if (!token) {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }

    try {
      request.user = this.authService.verifyAccessToken(token);
      return true;
    } catch {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }
  }
}

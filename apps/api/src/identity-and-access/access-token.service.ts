import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';

export type AccessTokenClaims = {
  sub: string;
  sid: string;
  email: string;
};

const ACCESS_TOKEN_ISSUER = 'coffee-order-api';
const ACCESS_TOKEN_AUDIENCE = 'coffee-order-api';
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class AccessTokenService {
  readonly expiresInSeconds: number;
  private readonly secret: string;

  constructor() {
    this.secret =
      process.env.ACCESS_TOKEN_SECRET?.trim() ||
      randomBytes(32).toString('base64url');
    this.expiresInSeconds = positiveInteger(
      process.env.ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  sign(userId: string, email: string, sessionId: string): string {
    return jwt.sign(
      {
        sub: userId,
        sid: sessionId,
        email,
      },
      this.secret,
      {
        algorithm: 'HS256',
        audience: ACCESS_TOKEN_AUDIENCE,
        expiresIn: this.expiresInSeconds,
        issuer: ACCESS_TOKEN_ISSUER,
      },
    );
  }

  verify(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: ACCESS_TOKEN_ISSUER,
      });

      if (!this.isAccessTokenPayload(payload)) {
        throw new Error('Invalid access token claims');
      }

      return {
        sub: payload.sub,
        sid: payload.sid,
        email: payload.email,
      };
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private isAccessTokenPayload(
    payload: string | JwtPayload,
  ): payload is JwtPayload & AccessTokenClaims {
    return (
      typeof payload !== 'string' &&
      typeof payload.sub === 'string' &&
      typeof payload.sid === 'string' &&
      typeof payload.email === 'string'
    );
  }
}

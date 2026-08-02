import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { authenticationEvents, refreshSessions, users } from '../db/schema';
import { AccessTokenClaims } from './access-token.service';
import { AccessTokenService } from './access-token.service';
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
} from './password-and-token-crypto';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';
const INVALID_ACCESS_TOKEN_MESSAGE = 'Invalid access token';
const AUTHENTICATION_REQUIRED_MESSAGE = 'Authentication required';
const DEFAULT_REFRESH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 200;

type AccountRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
};

type PublicAccount = Pick<AccountRecord, 'id' | 'email' | 'name'>;

export type AuthenticationResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PublicAccount;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

function normalizeRegistrationName(
  value: unknown,
  fallbackEmail: string,
): string | null {
  if (value === undefined || value === null || value === '') {
    return fallbackEmail;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const name = value.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
}

function isValidPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@Injectable()
export class AuthService {
  private readonly refreshSessionTtlSeconds: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly accessTokenService: AccessTokenService,
  ) {
    this.refreshSessionTtlSeconds = positiveInteger(
      process.env.REFRESH_SESSION_TTL_SECONDS ??
        process.env.REFRESH_TOKEN_TTL_SECONDS,
      DEFAULT_REFRESH_SESSION_TTL_SECONDS,
    );
  }

  async register(input: RegisterDto): Promise<AuthenticationResponse> {
    const email = normalizeEmail(input?.email);
    const password = input?.password;
    const name = normalizeRegistrationName(input?.name, email ?? '');

    if (!email || !isValidPassword(password) || !name) {
      throw new BadRequestException('Invalid registration input');
    }

    const passwordHash = await hashPassword(password);
    const refreshToken = generateRefreshToken();
    const now = new Date();

    try {
      const result = await this.db.transaction(async (tx) => {
        const [existingUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existingUser) {
          throw new ConflictException('Registration failed');
        }

        const [user] = await tx
          .insert(users)
          .values({
            id: randomUUID(),
            email,
            name,
            passwordHash,
          })
          .returning({
            id: users.id,
            email: users.email,
            name: users.name,
          });

        if (!user) {
          throw new Error('Registration did not create an account');
        }

        const [session] = await tx
          .insert(refreshSessions)
          .values({
            id: randomUUID(),
            userId: user.id,
            familyId: randomUUID(),
            tokenHash: hashRefreshToken(refreshToken),
            status: 'ACTIVE',
            expiresAt: this.refreshSessionExpiry(now),
          })
          .returning();

        if (!session) {
          throw new Error('Registration did not create a session');
        }

        return { sessionId: session.id, user };
      });

      return this.createAuthenticationResponse(
        result.user,
        result.sessionId,
        refreshToken,
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw new ConflictException('Registration failed');
      }
      throw new InternalServerErrorException('Registration failed');
    }
  }

  async login(input: LoginDto): Promise<AuthenticationResponse> {
    const email = normalizeEmail(input?.email);
    const password = input?.password;

    if (!email || !isValidPassword(password)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    let user: AccountRecord | undefined;
    try {
      [user] = await this.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    } catch {
      throw new InternalServerErrorException('Login failed');
    }

    const passwordMatches = await verifyPassword(password, user?.passwordHash);
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const refreshToken = generateRefreshToken();
    const now = new Date();

    try {
      const [session] = await this.db.transaction(async (tx) =>
        tx
          .insert(refreshSessions)
          .values({
            id: randomUUID(),
            userId: user.id,
            familyId: randomUUID(),
            tokenHash: hashRefreshToken(refreshToken),
            status: 'ACTIVE',
            expiresAt: this.refreshSessionExpiry(now),
          })
          .returning(),
      );

      if (!session) {
        throw new Error('Login did not create a session');
      }

      return this.createAuthenticationResponse(user, session.id, refreshToken);
    } catch {
      throw new InternalServerErrorException('Login failed');
    }
  }

  async refresh(input: RefreshDto): Promise<AuthenticationResponse> {
    const refreshToken = input?.refreshToken;
    if (!isNonEmptyString(refreshToken)) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const now = new Date();

    let result:
      | {
          sessionId: string;
          user: AccountRecord;
          refreshToken: string;
        }
      | undefined;

    try {
      result = await this.db.transaction(async (tx) => {
        const [claimedSession] = await tx
          .update(refreshSessions)
          .set({
            status: 'REVOKED',
            lastUsedAt: now,
            revokedAt: now,
            revocationReason: 'ROTATED',
          })
          .where(
            and(
              eq(refreshSessions.tokenHash, tokenHash),
              eq(refreshSessions.status, 'ACTIVE'),
              gt(refreshSessions.expiresAt, now),
            ),
          )
          .returning();

        if (claimedSession) {
          const [user] = await tx
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
              passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.id, claimedSession.userId))
            .limit(1);

          if (!user) {
            return undefined;
          }

          const nextRefreshToken = generateRefreshToken();
          const [nextSession] = await tx
            .insert(refreshSessions)
            .values({
              id: randomUUID(),
              userId: claimedSession.userId,
              familyId: claimedSession.familyId,
              tokenHash: hashRefreshToken(nextRefreshToken),
              status: 'ACTIVE',
              expiresAt: this.refreshSessionExpiry(now),
            })
            .returning();

          if (!nextSession) {
            throw new Error('Refresh did not create a session');
          }

          return {
            sessionId: nextSession.id,
            user,
            refreshToken: nextRefreshToken,
          };
        }

        const [presentedSession] = await tx
          .select()
          .from(refreshSessions)
          .where(eq(refreshSessions.tokenHash, tokenHash))
          .limit(1);

        if (!presentedSession) {
          return undefined;
        }

        if (presentedSession.status === 'ACTIVE') {
          await tx
            .update(refreshSessions)
            .set({ status: 'EXPIRED' })
            .where(
              and(
                eq(refreshSessions.id, presentedSession.id),
                eq(refreshSessions.status, 'ACTIVE'),
              ),
            );
          return undefined;
        }

        if (
          presentedSession.status === 'REVOKED' &&
          presentedSession.revocationReason === 'ROTATED'
        ) {
          await tx
            .update(refreshSessions)
            .set({
              status: 'REVOKED',
              revokedAt: now,
              revocationReason: 'TOKEN_REUSE',
            })
            .where(eq(refreshSessions.familyId, presentedSession.familyId));

          await tx.insert(authenticationEvents).values({
            id: randomUUID(),
            userId: presentedSession.userId,
            sessionId: presentedSession.id,
            familyId: presentedSession.familyId,
            eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
          });
        }

        return undefined;
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new InternalServerErrorException('Refresh failed');
    }

    if (!result) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    return this.createAuthenticationResponse(
      result.user,
      result.sessionId,
      result.refreshToken,
    );
  }

  async logout(
    refreshToken?: unknown,
    accessSessionId?: string,
  ): Promise<{ success: true }> {
    const now = new Date();

    try {
      await this.db.transaction(async (tx) => {
        if (isNonEmptyString(refreshToken)) {
          const tokenHash = hashRefreshToken(refreshToken);
          const [session] = await tx
            .select({
              id: refreshSessions.id,
              status: refreshSessions.status,
              expiresAt: refreshSessions.expiresAt,
            })
            .from(refreshSessions)
            .where(eq(refreshSessions.tokenHash, tokenHash))
            .limit(1);

          if (session?.status === 'ACTIVE') {
            if (session.expiresAt <= now) {
              await tx
                .update(refreshSessions)
                .set({ status: 'EXPIRED' })
                .where(
                  and(
                    eq(refreshSessions.id, session.id),
                    eq(refreshSessions.status, 'ACTIVE'),
                  ),
                );
            } else {
              await tx
                .update(refreshSessions)
                .set({
                  status: 'REVOKED',
                  revokedAt: now,
                  revocationReason: 'LOGOUT',
                })
                .where(
                  and(
                    eq(refreshSessions.id, session.id),
                    eq(refreshSessions.status, 'ACTIVE'),
                  ),
                );
            }
          }
          return;
        }

        if (isNonEmptyString(accessSessionId)) {
          await tx
            .update(refreshSessions)
            .set({
              status: 'REVOKED',
              revokedAt: now,
              revocationReason: 'LOGOUT',
            })
            .where(
              and(
                eq(refreshSessions.id, accessSessionId),
                eq(refreshSessions.status, 'ACTIVE'),
              ),
            );
        }
      });
    } catch {
      throw new InternalServerErrorException('Logout failed');
    }

    return { success: true };
  }

  async logoutAll(userId: string): Promise<{ success: true }> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(refreshSessions)
          .set({
            status: 'REVOKED',
            revokedAt: new Date(),
            revocationReason: 'LOGOUT_ALL',
          })
          .where(
            and(
              eq(refreshSessions.userId, userId),
              eq(refreshSessions.status, 'ACTIVE'),
            ),
          );
      });
    } catch {
      throw new InternalServerErrorException('Logout failed');
    }

    return { success: true };
  }

  async userIdForRefreshToken(refreshToken: unknown): Promise<string> {
    if (!isNonEmptyString(refreshToken)) {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }

    try {
      const [session] = await this.db
        .select({ userId: refreshSessions.userId })
        .from(refreshSessions)
        .where(eq(refreshSessions.tokenHash, hashRefreshToken(refreshToken)))
        .limit(1);

      if (!session) {
        throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
      }

      return session.userId;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new InternalServerErrorException('Logout failed');
    }
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    if (!isNonEmptyString(token)) {
      throw new UnauthorizedException(INVALID_ACCESS_TOKEN_MESSAGE);
    }
    return this.accessTokenService.verify(token);
  }

  private refreshSessionExpiry(now: Date): Date {
    return new Date(now.getTime() + this.refreshSessionTtlSeconds * 1000);
  }

  private createAuthenticationResponse(
    user: AccountRecord | PublicAccount,
    sessionId: string,
    refreshToken: string,
  ): AuthenticationResponse {
    return {
      accessToken: this.accessTokenService.sign(user.id, user.email, sessionId),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenService.expiresInSeconds,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }
}

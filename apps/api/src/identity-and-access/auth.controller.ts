import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './dto/auth.dto';

function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return undefined;
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedException('Invalid access token');
  }
  return token;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Body() body: LogoutDto) {
    const bearerToken = getBearerToken(request);
    const accessSessionId = bearerToken
      ? this.authService.verifyAccessToken(bearerToken).sid
      : undefined;

    return this.authService.logout(body?.refreshToken, accessSessionId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() request: Request, @Body() body: LogoutDto) {
    const bearerToken = getBearerToken(request);
    const userId = bearerToken
      ? this.authService.verifyAccessToken(bearerToken).sub
      : await this.authService.userIdForRefreshToken(body?.refreshToken);

    return this.authService.logoutAll(userId);
  }
}

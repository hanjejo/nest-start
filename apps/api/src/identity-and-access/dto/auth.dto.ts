export class RegisterDto {
  email!: string;
  password!: string;
  name?: string;
}

export class LoginDto {
  email!: string;
  password!: string;
}

export class RefreshDto {
  refreshToken!: string;
}

export class LogoutDto {
  refreshToken?: string;
}

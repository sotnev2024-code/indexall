export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
}

export interface AuthPayload {
  userId: number;
  email: string;
  plan: string;
}

export interface JwtToken {
  accessToken: string;
  expiresIn: number;
}

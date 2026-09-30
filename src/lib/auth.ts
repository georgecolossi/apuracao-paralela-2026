import { cookies } from 'next/headers';
import * as jwt from 'jsonwebtoken';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET_NOT_CONFIGURED');
    }
    return 'fallback_inseguro_local';
  }
  return secret;
}

export type AuthenticatedUser = {
  authenticated: true;
  user: {
    userId: string;
    role?: string;
  };
};

export type UnauthenticatedUser = {
  authenticated: false;
  reason: string;
};

export type AuthResult = AuthenticatedUser | UnauthenticatedUser;

export async function requireAuthenticatedUser(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session')?.value;

  if (!token) {
    return { authenticated: false, reason: 'NO_TOKEN' };
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    
    if (typeof payload !== 'object' || payload === null) {
      return { authenticated: false, reason: 'INVALID_TOKEN' };
    }
    
    if (typeof (payload as jwt.JwtPayload).userId !== 'string' || ((payload as jwt.JwtPayload).userId as string).trim() === '') {
      return { authenticated: false, reason: 'INVALID_TOKEN_IDENTITY' };
    }

    return { 
      authenticated: true, 
      user: {
        userId: (payload as jwt.JwtPayload).userId,
        role: typeof (payload as jwt.JwtPayload).role === 'string' ? (payload as jwt.JwtPayload).role : undefined,
      }
    };
  } catch (err) {
    return { authenticated: false, reason: 'INVALID_TOKEN' };
  }
}

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

export async function requireAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session')?.value;

  if (!token) {
    return { authenticated: false, reason: 'NO_TOKEN' };
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as any;
    return { authenticated: true, user: payload };
  } catch (err) {
    return { authenticated: false, reason: 'INVALID_TOKEN' };
  }
}

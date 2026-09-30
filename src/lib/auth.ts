import { cookies } from 'next/headers';
import * as jwt from 'jsonwebtoken';

export async function requireAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session')?.value;

  if (!token) {
    return { authenticated: false, reason: 'NO_TOKEN' };
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback_inseguro_local') as any;
    return { authenticated: true, user: payload };
  } catch (err) {
    return { authenticated: false, reason: 'INVALID_TOKEN' };
  }
}

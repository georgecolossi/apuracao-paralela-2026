import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { generateCsrfToken } from '@/lib/security/csrf';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const csrfToken = generateCsrfToken(auth.user.userId, auth.user.sessionVersion ?? 0);
  return NextResponse.json({ csrfToken });
}

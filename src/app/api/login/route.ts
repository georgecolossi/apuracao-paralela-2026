import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: 'Usuário e senha são obrigatórios' }, { status: 400 });
  }

  const normalizedUsername = String(username).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedUsername } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  // Preserva integralmente a senha informada, sem trim() ou mutações ocultas
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  const sessionVersion = typeof user.sessionVersion === 'number' ? user.sessionVersion : 0;
  const { getJwtSecret } = await import('@/lib/auth');
  const token = jwt.sign(
    { 
      userId: user.id, 
      role: user.role,
      sessionVersion 
    },
    getJwtSecret(),
    { expiresIn: '8h' }
  );

  const cookieStore = await cookies();
  cookieStore.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN',
      result: 'SUCCESS'
    }
  });

  const { generateCsrfToken } = await import('@/lib/security/csrf');
  const csrfToken = generateCsrfToken(user.id, sessionVersion);

  return NextResponse.json({ success: true, role: user.role, csrfToken });
}

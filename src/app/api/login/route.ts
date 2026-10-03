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

  const normalizedUsername = username.trim();
  const user = await prisma.user.findUnique({ where: { email: normalizedUsername } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  const { getJwtSecret } = await import('@/lib/auth');
  const token = jwt.sign(
    { userId: user.id, role: user.role },
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

  return NextResponse.json({ success: true, role: user.role });
}

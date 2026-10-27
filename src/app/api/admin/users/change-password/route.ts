import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser, getJwtSecret } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/validation/password';
import { validateCsrfProtection } from '@/lib/security/csrf';

/**
 * Troca de Senha Própria pelo Usuário Autenticado (PR 2 / v2.0)
 * 
 * POST /api/admin/users/change-password
 */

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const csrf = validateCsrfProtection(req, { userId: auth.user.userId, sessionVersion: auth.user.sessionVersion });
    if (!csrf.valid) {
      return NextResponse.json({ error: 'Falha na validação de origem (CSRF).', reason: csrf.reason }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Payload JSON inválido.' }, { status: 400 });
    }

    const { currentPassword, newPassword } = body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json({ error: 'A senha atual é obrigatória.' }, { status: 400 });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'A nova senha é obrigatória.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.userId }
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return NextResponse.json({ error: 'A senha atual informada está incorreta.' }, { status: 401 });
    }

    const pwdValidation = validatePasswordStrength(newPassword);
    if (!pwdValidation.valid) {
      return NextResponse.json({
        error: 'A nova senha não atende aos requisitos mínimos de segurança.',
        details: pwdValidation.errors
      }, { status: 400 });
    }

    // Hash da nova senha sem remoção de espaços em branco (sem trim)
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atualização atômica da senha, incremento de versão de sessão e auditoria transacional
    const updatedUser = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 }
        }
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'PASSWORD_CHANGED',
          result: 'SUCCESS',
          identifiers: `User: ${user.email} (${user.id})`,
          metadata: JSON.stringify({
            selfService: true,
            otherSessionsRevoked: true
          })
        }
      });

      return u;
    });

    // Emite um novo token JWT com a nova sessionVersion para manter unicamente esta sessão ativa
    const newToken = jwt.sign(
      { 
        userId: updatedUser.id, 
        role: updatedUser.role,
        sessionVersion: updatedUser.sessionVersion 
      },
      getJwtSecret(),
      { expiresIn: '8h' }
    );

    const cookieStore = await cookies();
    cookieStore.set('admin_session', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });

    const { generateCsrfToken } = await import('@/lib/security/csrf');
    const csrfToken = generateCsrfToken(updatedUser.id, updatedUser.sessionVersion);

    return NextResponse.json({
      success: true,
      message: 'Senha alterada com sucesso.',
      csrfToken
    });

  } catch (error) {
    console.error('[API_ADMIN_USER_CHANGE_PASSWORD_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao alterar a senha.' }, { status: 500 });
  }
}

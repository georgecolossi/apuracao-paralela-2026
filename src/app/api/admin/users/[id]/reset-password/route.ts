import { NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/validation/password';
import { validateCsrfProtection } from '@/lib/security/csrf';

/**
 * Redefinição Administrativa de Senha (PR 2 / v2.0)
 * 
 * POST /api/admin/users/[id]/reset-password
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const csrf = validateCsrfProtection(req);
    if (!csrf.valid) {
      return NextResponse.json({ error: 'Falha na validação de origem (CSRF).', reason: csrf.reason }, { status: 403 });
    }

    const { id } = await params;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Payload JSON inválido.' }, { status: 400 });
    }

    const { newPassword } = body;
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'A nova senha é obrigatória.' }, { status: 400 });
    }

    const pwdValidation = validatePasswordStrength(newPassword);
    if (!pwdValidation.valid) {
      return NextResponse.json({
        error: 'A senha informada não atende aos requisitos mínimos de segurança.',
        details: pwdValidation.errors
      }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(newPassword.trim(), 12);

    // Atualiza a senha e atualiza o timestamp updatedAt para revogar imediatamente todas as sessões ativas
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        updatedAt: new Date()
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: auth.user.userId,
        action: 'USER_PASSWORD_RESET',
        result: 'SUCCESS',
        identifiers: `User: ${targetUser.email} (${targetUser.id})`,
        metadata: JSON.stringify({
          resetByAdminId: auth.user.userId,
          targetUserId: targetUser.id,
          targetEmail: targetUser.email,
          sessionsRevoked: true
        })
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Senha redefinida com sucesso. Todas as sessões ativas deste usuário foram revogadas.'
    });

  } catch (error) {
    console.error('[API_ADMIN_USER_RESET_PASSWORD_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao redefinir senha do usuário.' }, { status: 500 });
  }
}

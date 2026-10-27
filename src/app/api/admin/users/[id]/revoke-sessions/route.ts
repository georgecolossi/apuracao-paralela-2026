import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import { validateCsrfProtection } from '@/lib/security/csrf';

/**
 * Revogação Forçada de Sessões de Usuário (PR 2 / v2.0)
 * 
 * POST /api/admin/users/[id]/revoke-sessions
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
    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    // Atualiza o updatedAt para o instante atual, invalidando tokens JWT emitidos previamente
    await prisma.user.update({
      where: { id },
      data: {
        updatedAt: new Date()
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: auth.user.userId,
        action: 'USER_SESSIONS_REVOKED',
        result: 'SUCCESS',
        identifiers: `User: ${targetUser.email} (${targetUser.id})`,
        metadata: JSON.stringify({
          revokedBy: auth.user.userId,
          targetUserId: targetUser.id
        })
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Todas as sessões ativas do usuário foram revogadas com sucesso.'
    });

  } catch (error) {
    console.error('[API_ADMIN_USER_REVOKE_SESSIONS_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao revogar sessões do usuário.' }, { status: 500 });
  }
}

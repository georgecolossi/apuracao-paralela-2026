import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser, sanitizeUser, assertNotLastActiveAdmin } from '@/lib/auth';
import { validateCsrfProtection } from '@/lib/security/csrf';

/**
 * Ativação / Desativação de Usuários (PR 2 / v2.0)
 * 
 * PATCH /api/admin/users/[id]/status
 */

export async function PATCH(
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

    const csrf = validateCsrfProtection(req, { userId: auth.user.userId, sessionVersion: auth.user.sessionVersion });
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

    const { isActive } = body;
    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'O campo isActive deve ser booleano (true ou false).' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      // Se estiver tentando desativar um ADMIN, verifica proteção do último administrador atomicamente dentro da transação
      if (!isActive && targetUser.role === 'ADMIN' && targetUser.isActive) {
        await assertNotLastActiveAdmin(tx, targetUser.id, 'DEACTIVATE');
      }

      const u = await tx.user.update({
        where: { id },
        data: {
          isActive,
          // Caso desativado, incrementa a versão de sessão para invalidar imediatamente qualquer token ativo
          ...(isActive ? {} : { sessionVersion: { increment: 1 } })
        }
      });

      const action = isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
      await tx.auditLog.create({
        data: {
          userId: auth.user.userId,
          action,
          result: 'SUCCESS',
          identifiers: `User: ${u.email} (${u.id})`,
          metadata: JSON.stringify({
            previousStatus: targetUser.isActive,
            newStatus: u.isActive
          })
        }
      });

      return u;
    });

    return NextResponse.json({
      success: true,
      user: sanitizeUser(updatedUser)
    });

  } catch (error: any) {
    if (error.code === 'CANNOT_REMOVE_LAST_ADMIN') {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error('[API_ADMIN_USER_STATUS_PATCH_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao alterar status do usuário.' }, { status: 500 });
  }
}

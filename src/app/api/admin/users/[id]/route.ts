import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireAuthenticatedUser,
  sanitizeUser,
  assertNotLastActiveAdmin,
  VALID_ROLES,
  UserRole
} from '@/lib/auth';
import { validateCsrfProtection } from '@/lib/security/csrf';

/**
 * Operações Específicas por Usuário (PR 2 / v2.0)
 * 
 * GET /api/admin/users/[id] - Detalhes do usuário
 * PATCH /api/admin/users/[id] - Edição de dados e papel
 * DELETE /api/admin/users/[id] - Exclusão física ou desativação segura
 */

export async function GET(
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

    const { id } = await params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            reportsProcessed: true,
            scanSessions: true,
            reportParts: true,
            auditLogs: true
          }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('[API_ADMIN_USER_DETAIL_GET_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao consultar detalhes do usuário.' }, { status: 500 });
  }
}

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

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const { name, email, role } = body;
    const dataToUpdate: any = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return NextResponse.json({ error: 'O nome não pode ser vazio.' }, { status: 400 });
      }
      dataToUpdate.name = name.trim();
    }

    if (email !== undefined) {
      if (typeof email !== 'string' || email.trim() === '') {
        return NextResponse.json({ error: 'O email não pode ser vazio.' }, { status: 400 });
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail !== targetUser.email) {
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
          return NextResponse.json({ error: 'Já existe outro usuário cadastrado com este email.' }, { status: 409 });
        }
        dataToUpdate.email = normalizedEmail;
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      if (role !== undefined) {
        const targetRole = String(role).trim().toUpperCase();
        if (!VALID_ROLES.includes(targetRole as UserRole)) {
          const err = new Error(`Papel inválido. Permitidos: ${VALID_ROLES.join(', ')}.`);
          (err as any).code = 'INVALID_ROLE';
          throw err;
        }

        if (targetUser.role === 'ADMIN' && targetRole !== 'ADMIN') {
          await assertNotLastActiveAdmin(tx, targetUser.id, 'DEMOTE');
        }

        dataToUpdate.role = targetRole;

        // Se houver alteração de papel, incrementa a versão da sessão para invalidar imediatamente permissões antigas
        if (targetRole !== targetUser.role) {
          dataToUpdate.sessionVersion = { increment: 1 };
        }
      }

      const u = await tx.user.update({
        where: { id },
        data: dataToUpdate
      });

      await tx.auditLog.create({
        data: {
          userId: auth.user.userId,
          action: 'USER_UPDATED',
          result: 'SUCCESS',
          identifiers: `User: ${u.email} (${u.id})`,
          metadata: JSON.stringify({
            before: { name: targetUser.name, email: targetUser.email, role: targetUser.role },
            after: { name: u.name, email: u.email, role: u.role }
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
    console.error('[API_ADMIN_USER_PATCH_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao atualizar usuário.' }, { status: 500 });
  }
}

export async function DELETE(
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
    const targetUser = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            reportsProcessed: true,
            scanSessions: true,
            reportParts: true,
            auditLogs: true
          }
        }
      }
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Proteção contra exclusão do último ADMIN ativo dentro da transação
      await assertNotLastActiveAdmin(tx, targetUser.id, 'DELETE');

      const totalRelations =
        targetUser._count.reportsProcessed +
        targetUser._count.scanSessions +
        targetUser._count.reportParts +
        targetUser._count.auditLogs;

      // Se possuir histórico operacional ou de auditoria, realiza desativação lógica segura
      // para preservar a integridade referencial dos dados eleitorais
      if (totalRelations > 0) {
        const deactivated = await tx.user.update({
          where: { id },
          data: {
            isActive: false,
            sessionVersion: { increment: 1 }
          }
        });

        await tx.auditLog.create({
          data: {
            userId: auth.user.userId,
            action: 'USER_DEACTIVATED_HISTORIC',
            result: 'SUCCESS',
            identifiers: `User: ${targetUser.email} (${targetUser.id})`,
            metadata: JSON.stringify({
              reason: 'Preservação de integridade referencial histórica',
              relationsCount: targetUser._count
            })
          }
        });

        return {
          success: true,
          deleted: false,
          deactivated: true,
          message: 'O usuário possui registros operacionais vinculados e foi desativado com segurança para preservar o histórico eleitoral.',
          user: sanitizeUser(deactivated)
        };
      }

      // Caso não possua relações vinculadas, exclusão física atômica
      await tx.user.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: auth.user.userId,
          action: 'USER_DELETED',
          result: 'SUCCESS',
          identifiers: `User: ${targetUser.email} (${targetUser.id})`,
          metadata: JSON.stringify({
            deletedUser: {
              id: targetUser.id,
              name: targetUser.name,
              email: targetUser.email,
              role: targetUser.role
            }
          })
        }
      });

      return {
        success: true,
        deleted: true,
        message: 'Usuário excluído com sucesso.'
      };
    });

    return NextResponse.json(result);

  } catch (error: any) {
    if (error.code === 'CANNOT_REMOVE_LAST_ADMIN') {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error('[API_ADMIN_USER_DELETE_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao processar exclusão de usuário.' }, { status: 500 });
  }
}

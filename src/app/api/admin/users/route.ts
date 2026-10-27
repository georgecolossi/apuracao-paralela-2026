import { NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser, sanitizeUser, VALID_ROLES, UserRole } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/validation/password';
import { validateCsrfProtection } from '@/lib/security/csrf';

/**
 * API Administrativa de Gestão de Usuários (PR 2 / v2.0)
 * 
 * GET /api/admin/users - Listagem de usuários
 * POST /api/admin/users - Criação de novos usuários com RBAC
 */

export async function GET(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get('role');
    const statusFilter = searchParams.get('status');
    const search = searchParams.get('search')?.trim();

    const where: any = {};

    if (roleFilter && VALID_ROLES.includes(roleFilter as UserRole)) {
      where.role = roleFilter;
    }

    if (statusFilter === 'active') {
      where.isActive = true;
    } else if (statusFilter === 'inactive') {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } }
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: [
        { role: 'asc' },
        { name: 'asc' }
      ],
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
            scanSessions: true
          }
        }
      }
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[API_ADMIN_USERS_GET_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao consultar usuários.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Payload JSON inválido.' }, { status: 400 });
    }

    const { name, email, password, role } = body;

    // 1. Validação de campos obrigatórios
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'O nome do usuário é obrigatório.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || email.trim() === '') {
      return NextResponse.json({ error: 'O email/login do usuário é obrigatório.' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();

    // Validação básica de formato de email/identificador
    if (normalizedEmail.length < 3 || normalizedEmail.length > 120) {
      return NextResponse.json({ error: 'Identificador/email com comprimento inválido.' }, { status: 400 });
    }

    // 2. Validação do Papel (RBAC)
    const targetRole = (role || 'OPERATOR').trim().toUpperCase();
    if (!VALID_ROLES.includes(targetRole as UserRole)) {
      return NextResponse.json({
        error: `Papel inválido. Os papéis permitidos são: ${VALID_ROLES.join(', ')}.`
      }, { status: 400 });
    }

    // 3. Validação de Complexidade da Senha
    const pwdValidation = validatePasswordStrength(password);
    if (!pwdValidation.valid) {
      return NextResponse.json({
        error: 'A senha informada não atende aos requisitos mínimos de segurança.',
        details: pwdValidation.errors
      }, { status: 400 });
    }

    // 4. Verificação de Unicidade
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existing) {
      return NextResponse.json({
        error: 'Já existe um usuário cadastrado com este email/identificador.'
      }, { status: 409 });
    }

    // 5. Hash Criptográfico (bcrypt com custo 12) preservando a senha sem trim()
    const passwordHash = await bcrypt.hash(password, 12);

    // 6. Criação atômica do usuário e do registro de auditoria na mesma transação
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          passwordHash,
          role: targetRole,
          isActive: true
        }
      });

      await tx.auditLog.create({
        data: {
          userId: auth.user.userId,
          action: 'USER_CREATED',
          result: 'SUCCESS',
          identifiers: `User: ${created.email} (${created.id})`,
          metadata: JSON.stringify({
            createdUserId: created.id,
            name: created.name,
            email: created.email,
            role: created.role
          })
        }
      });

      return created;
    });

    return NextResponse.json({
      success: true,
      user: sanitizeUser(newUser)
    }, { status: 201 });

  } catch (error) {
    console.error('[API_ADMIN_USERS_POST_ERROR]', error);
    return NextResponse.json({ error: 'Erro interno ao criar usuário.' }, { status: 500 });
  }
}

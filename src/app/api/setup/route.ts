import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const adminCount = await prisma.user.count({
      where: { role: 'ADMIN' }
    });

    return NextResponse.json({
      isInitialized: adminCount > 0,
      requiresSetupToken: !!process.env.ADMIN_SETUP_TOKEN
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao verificar estado de inicialização.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Payload JSON inválido.' }, { status: 400 });
    }

    const { name, email, password, setupToken } = payload || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome do administrador deve ter pelo menos 2 caracteres.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'E-mail do administrador inválido.' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Senha deve conter no mínimo 8 caracteres.' }, { status: 400 });
    }

    // Se o ambiente configurar um token de setup obrigatório, valida-o
    const requiredSetupToken = process.env.ADMIN_SETUP_TOKEN;
    if (requiredSetupToken && requiredSetupToken.trim() !== '') {
      if (!setupToken || setupToken !== requiredSetupToken) {
        return NextResponse.json({ error: 'Token de autorização de setup inválido ou ausente.' }, { status: 403 });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Executa em transação serializada para evitar condições de corrida (dupla criação simultânea)
    try {
      const newUser = await prisma.$transaction(async (tx) => {
        const existingAdmin = await tx.user.findFirst({
          where: { role: 'ADMIN' }
        });

        if (existingAdmin) {
          throw new Error('ALREADY_INITIALIZED');
        }

        const existingEmail = await tx.user.findUnique({
          where: { email: normalizedEmail }
        });

        if (existingEmail) {
          throw new Error('EMAIL_EXISTS');
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const created = await tx.user.create({
          data: {
            name: name.trim(),
            email: normalizedEmail,
            passwordHash,
            role: 'ADMIN',
            isActive: true,
          }
        });

        await tx.auditLog.create({
          data: {
            userId: created.id,
            action: 'INITIAL_ADMIN_SETUP',
            identifiers: `Email: ${created.email}`,
            result: 'SUCCESS',
            newStatus: 'ACTIVE',
            metadata: JSON.stringify({ mechanism: 'HTTP_SETUP_API' })
          }
        });

        return created;
      });

      return NextResponse.json({
        success: true,
        message: 'Administrador inicial criado com sucesso.',
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role
        }
      }, { status: 201 });
    } catch (txError: any) {
      if (txError?.message === 'ALREADY_INITIALIZED') {
        return NextResponse.json({
          error: 'SYSTEM_ALREADY_INITIALIZED',
          message: 'O sistema já possui um administrador configurado. Setup inicial encerrado.'
        }, { status: 403 });
      }
      if (txError?.message === 'EMAIL_EXISTS') {
        return NextResponse.json({
          error: 'EMAIL_ALREADY_IN_USE',
          message: 'O e-mail informado já está cadastrado no sistema.'
        }, { status: 409 });
      }
      throw txError;
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro interno ao criar administrador inicial.' }, { status: 500 });
  }
}

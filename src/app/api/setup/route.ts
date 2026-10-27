import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * SEGURANÇA DO TOKEN DE SETUP (ADMIN_SETUP_TOKEN):
 * - Requisito de Entropia: O token deve ser gerado por um gerador criptograficamente
 *   seguro (CSPRNG), com pelo menos 128 bits de entropia (ex.: `openssl rand -hex 16`
 *   ou `crypto.randomBytes(16).toString('hex')`).
 * - Nota de Segurança: O comprimento mínimo de 16 caracteres atua estritamente como um
 *   guardrail preliminar e NÃO substitui nem comprova entropia adequada por si só.
 * - Confidencialidade: O token NUNCA deve ser versionado no repositório, gravado em logs
 *   ou retornado em endpoints públicos.
 * - Desativação Pós-Instalação: Após a criação do primeiro administrador, o endpoint é
 *   permanentemente bloqueado pela existência de usuários ADMIN no banco. Para reforçar
 *   a segurança em produção, a variável `ADMIN_SETUP_TOKEN` deve ser removida do ambiente
 *   ou a flag `DISABLE_HTTP_SETUP=true` deve ser configurada.
 */
const MIN_TOKEN_LENGTH = 16;

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function GET() {
  try {
    const adminCount = await prisma.user.count({
      where: { role: 'ADMIN' }
    });

    const isExplicitlyDisabled = process.env.DISABLE_HTTP_SETUP === 'true';
    const envToken = process.env.ADMIN_SETUP_TOKEN;
    const isTokenConfigured = typeof envToken === 'string' && envToken.trim().length >= MIN_TOKEN_LENGTH;

    return NextResponse.json({
      isInitialized: adminCount > 0,
      httpSetupEnabled: !isExplicitlyDisabled && isTokenConfigured && adminCount === 0
    });
  } catch {
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Erro ao verificar estado do setup.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // 1. Verificação de Desativação Explícita
    if (process.env.DISABLE_HTTP_SETUP === 'true') {
      return NextResponse.json({
        error: 'HTTP_SETUP_DISABLED',
        message: 'O setup via HTTP foi desativado explicitamente no ambiente (DISABLE_HTTP_SETUP=true). Utilize o script CLI seguro: scripts/create-initial-admin.mjs'
      }, { status: 403 });
    }

    // 2. Política Fail-Closed: Setup HTTP desativado se o token não estiver configurado com comprimento mínimo
    const configuredToken = process.env.ADMIN_SETUP_TOKEN;
    if (!configuredToken || typeof configuredToken !== 'string' || configuredToken.trim().length < MIN_TOKEN_LENGTH) {
      return NextResponse.json({
        error: 'HTTP_SETUP_DISABLED',
        message: 'O setup via HTTP está desativado por política de segurança fail-closed. Para habilitar o setup web, configure a variável de ambiente ADMIN_SETUP_TOKEN com no mínimo 128 bits de entropia gerados por CSPRNG (mínimo de 16 caracteres), ou inicialize o primeiro administrador diretamente pelo console seguro com o script CLI: scripts/create-initial-admin.mjs'
      }, { status: 403 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_PAYLOAD', message: 'Payload JSON inválido.' }, { status: 400 });
    }

    const { name, email, password, setupToken } = payload || {};

    // 3. Validação estrita do token de setup via timingSafeEqual
    if (!setupToken || typeof setupToken !== 'string' || !timingSafeEqual(setupToken.trim(), configuredToken.trim())) {
      return NextResponse.json({
        error: 'INVALID_SETUP_TOKEN',
        message: 'Token de autorização de setup inválido ou ausente.'
      }, { status: 403 });
    }

    // 4. Validação de dados do administrador
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({
        error: 'INVALID_NAME',
        message: 'Nome do administrador deve ter pelo menos 2 caracteres.'
      }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return NextResponse.json({
        error: 'INVALID_EMAIL',
        message: 'E-mail do administrador inválido.'
      }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({
        error: 'WEAK_PASSWORD',
        message: 'A senha do administrador deve conter no mínimo 8 caracteres.'
      }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 5. Criação atômica em transação serializada contra condições de corrida
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
            metadata: JSON.stringify({ mechanism: 'HTTP_SETUP_TOKEN_AUTHORIZED' })
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
  } catch {
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Erro interno durante o procedimento de setup.' }, { status: 500 });
  }
}

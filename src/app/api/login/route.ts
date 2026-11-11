import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { prisma } from '@/lib/db';
import {
  checkLoginRateLimit,
  clearLoginPairFailures,
  recordLoginFailure,
} from '@/lib/security/loginRateLimiter';

// Hash bcrypt sintaticamente válido usado quando o usuário não existe ou está inativo
// para equalizar o tempo de resposta e evitar enumeração de contas por timing.
const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

async function recordFailureAndBuildUnauthorizedResponse(
  clientIp: string,
  normalizedUsername: string,
  userId: string | null
) {
  const failure = recordLoginFailure(clientIp, normalizedUsername);
  if (failure.newlyBlocked) {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'LOGIN_RATE_LIMITED',
          result: 'BLOCKED',
          identifiers: JSON.stringify({ account: normalizedUsername }),
          ipAddress: clientIp,
          metadata: JSON.stringify({
            pairCount: failure.pairCount,
            ipCount: failure.ipCount,
            retryAfterSeconds: failure.retryAfterSeconds,
          }),
        },
      });
    } catch {
      // Falha de auditoria não deve alterar resposta padronizada de autenticação
    }
  }

  return NextResponse.json(
    { error: 'Credenciais inválidas', code: 'INVALID_CREDENTIALS' },
    { status: 401, headers: NO_STORE_HEADERS }
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Payload inválido.', code: 'INVALID_PAYLOAD' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Usuário e senha são obrigatórios', code: 'MISSING_CREDENTIALS' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json(
      { error: 'Usuário e senha são obrigatórios', code: 'MISSING_CREDENTIALS' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !password) {
    return NextResponse.json(
      { error: 'Usuário e senha são obrigatórios', code: 'MISSING_CREDENTIALS' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const rateLimitCheck = checkLoginRateLimit(req, normalizedUsername);
  if (!rateLimitCheck.allowed) {
    return NextResponse.json(
      {
        error: 'Muitas tentativas de login. Aguarde antes de tentar novamente.',
        code: 'TOO_MANY_ATTEMPTS',
        retryAfterSeconds: rateLimitCheck.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitCheck.retryAfterSeconds),
          ...NO_STORE_HEADERS,
        },
      }
    );
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedUsername } });
  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    return recordFailureAndBuildUnauthorizedResponse(
      rateLimitCheck.clientIp,
      normalizedUsername,
      user?.id ?? null
    );
  }

  // Preserva integralmente a senha informada, sem trim() ou mutações ocultas
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return recordFailureAndBuildUnauthorizedResponse(
      rateLimitCheck.clientIp,
      normalizedUsername,
      user.id
    );
  }

  clearLoginPairFailures(rateLimitCheck.clientIp, normalizedUsername);

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
      result: 'SUCCESS',
      ipAddress: rateLimitCheck.clientIp
    }
  });

  const { generateCsrfToken } = await import('@/lib/security/csrf');
  const csrfToken = generateCsrfToken(user.id, sessionVersion);

  return NextResponse.json({ success: true, role: user.role, csrfToken }, { headers: NO_STORE_HEADERS });
}

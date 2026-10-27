import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { GET, POST } from '@/app/api/setup/route';
import * as bcrypt from 'bcryptjs';

const VALID_SETUP_TOKEN = 'super-secure-production-setup-token-2026';

describe('PR 1 — Secure Admin Setup API (/api/setup) Fail-Closed Security Policy', () => {
  const originalEnvToken = process.env.ADMIN_SETUP_TOKEN;

  beforeEach(async () => {
    // Limpa registros de auditoria e usuários de teste
    await prisma.auditLog.deleteMany({
      where: { action: 'INITIAL_ADMIN_SETUP' }
    });
    await prisma.user.deleteMany({
      where: { email: { contains: 'setup-test' } }
    });
  });

  afterEach(() => {
    if (originalEnvToken !== undefined) {
      process.env.ADMIN_SETUP_TOKEN = originalEnvToken;
    } else {
      delete process.env.ADMIN_SETUP_TOKEN;
    }
  });

  it('GET /api/setup reporta httpSetupEnabled=false quando ADMIN_SETUP_TOKEN não está configurado', async () => {
    delete process.env.ADMIN_SETUP_TOKEN;
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.httpSetupEnabled).toBe(false);
  });

  it('GET /api/setup reporta httpSetupEnabled=true somente quando token é válido (>=16 chars) e não há admin', async () => {
    const existingAdmins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.user.deleteMany({ where: { role: 'ADMIN' } });

    try {
      process.env.ADMIN_SETUP_TOKEN = VALID_SETUP_TOKEN;
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isInitialized).toBe(false);
      expect(json.httpSetupEnabled).toBe(true);
    } finally {
      for (const a of existingAdmins) {
        await prisma.user.upsert({ where: { id: a.id }, update: {}, create: a });
      }
    }
  });

  it('POST /api/setup rejeita solicitação com 403 HTTP_SETUP_DISABLED quando token não está configurado', async () => {
    delete process.env.ADMIN_SETUP_TOKEN;

    const req = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tentativa Sem Token Env',
        email: 'setup-test-disabled@example.com',
        password: 'Password12345!',
        setupToken: 'any-token'
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('HTTP_SETUP_DISABLED');
    expect(json.message).toMatch(/scripts\/create-initial-admin\.mjs/);
  });

  it('POST /api/setup rejeita com 403 HTTP_SETUP_DISABLED se token configurado for menor que 16 caracteres', async () => {
    process.env.ADMIN_SETUP_TOKEN = 'curto_123'; // menos de 16 caracteres

    const req = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tentativa Token Fraco',
        email: 'setup-test-weak@example.com',
        password: 'Password12345!',
        setupToken: 'curto_123'
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('HTTP_SETUP_DISABLED');
  });

  it('POST /api/setup rejeita com 403 INVALID_SETUP_TOKEN se setupToken for incorreto ou ausente', async () => {
    process.env.ADMIN_SETUP_TOKEN = VALID_SETUP_TOKEN;

    // Sem setupToken
    const reqMissing = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tentativa Sem Token',
        email: 'setup-test-missing@example.com',
        password: 'Password12345!'
      })
    });
    const resMissing = await POST(reqMissing);
    expect(resMissing.status).toBe(403);
    const jsonMissing = await resMissing.json();
    expect(jsonMissing.error).toBe('INVALID_SETUP_TOKEN');

    // Token incorreto
    const reqWrong = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tentativa Token Errado',
        email: 'setup-test-wrong@example.com',
        password: 'Password12345!',
        setupToken: 'token-divergente-com-tamanho-longo-12345'
      })
    });
    const resWrong = await POST(reqWrong);
    expect(resWrong.status).toBe(403);
    const jsonWrong = await resWrong.json();
    expect(jsonWrong.error).toBe('INVALID_SETUP_TOKEN');
  });

  it('POST /api/setup valida parâmetros mínimos de nome, email e senha quando token é válido', async () => {
    process.env.ADMIN_SETUP_TOKEN = VALID_SETUP_TOKEN;

    // 1. Senha curta (< 8 chars)
    const reqShortPass = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Admin Teste',
        email: 'setup-test-short@example.com',
        password: '123',
        setupToken: VALID_SETUP_TOKEN
      })
    });
    const resShort = await POST(reqShortPass);
    expect(resShort.status).toBe(400);
    const jsonShort = await resShort.json();
    expect(jsonShort.error).toBe('WEAK_PASSWORD');

    // 2. Email inválido
    const reqBadEmail = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Admin Teste',
        email: 'invalid-email',
        password: 'StrongPassword123!',
        setupToken: VALID_SETUP_TOKEN
      })
    });
    const resBad = await POST(reqBadEmail);
    expect(resBad.status).toBe(400);
    const jsonBad = await resBad.json();
    expect(jsonBad.error).toBe('INVALID_EMAIL');

    // 3. Nome curto
    const reqShortName = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A',
        email: 'setup-test-name@example.com',
        password: 'StrongPassword123!',
        setupToken: VALID_SETUP_TOKEN
      })
    });
    const resName = await POST(reqShortName);
    expect(resName.status).toBe(400);
    const jsonName = await resName.json();
    expect(jsonName.error).toBe('INVALID_NAME');
  });

  it('POST /api/setup cria o primeiro administrador com hash e gera AuditLog', async () => {
    process.env.ADMIN_SETUP_TOKEN = VALID_SETUP_TOKEN;

    // Simula estado virgem removendo admins temporariamente
    const existingAdmins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.user.deleteMany({ where: { role: 'ADMIN' } });

    try {
      const email = 'setup-test-admin@example.com';
      const password = 'SuperSecurePassword2026!';
      const req = new Request('http://localhost/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Primeiro Administrador',
          email,
          password,
          setupToken: VALID_SETUP_TOKEN
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.user.email).toBe(email);
      expect(json.user.role).toBe('ADMIN');

      // Verifica se a senha foi hasheada no banco (não guardada em plain text)
      const userInDb = await prisma.user.findUnique({ where: { email } });
      expect(userInDb).not.toBeNull();
      expect(userInDb!.passwordHash).not.toBe(password);
      const passMatches = await bcrypt.compare(password, userInDb!.passwordHash);
      expect(passMatches).toBe(true);

      // Verifica AuditLog gerado
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'INITIAL_ADMIN_SETUP', userId: userInDb!.id }
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog!.result).toBe('SUCCESS');

      // Tentativa após criação: Segundo POST deve ser rejeitado com 403 SYSTEM_ALREADY_INITIALIZED
      const reqSecond = new Request('http://localhost/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Tentativa Invasora',
          email: 'setup-test-second@example.com',
          password: 'AnotherPassword123!',
          setupToken: VALID_SETUP_TOKEN
        })
      });
      const resSecond = await POST(reqSecond);
      expect(resSecond.status).toBe(403);
      const jsonSecond = await resSecond.json();
      expect(jsonSecond.error).toBe('SYSTEM_ALREADY_INITIALIZED');

    } finally {
      // Restaura admins pré-existentes
      for (const a of existingAdmins) {
        await prisma.user.upsert({
          where: { id: a.id },
          update: {},
          create: a
        });
      }
    }
  });

  it('POST /api/setup resiste a condições de corrida com apenas uma criação bem-sucedida', async () => {
    process.env.ADMIN_SETUP_TOKEN = VALID_SETUP_TOKEN;

    const existingAdmins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.user.deleteMany({ where: { role: 'ADMIN' } });

    try {
      const p1 = POST(new Request('http://localhost/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Admin Concorrente 1',
          email: 'setup-test-race1@example.com',
          password: 'PasswordRace123!',
          setupToken: VALID_SETUP_TOKEN
        })
      }));

      const p2 = POST(new Request('http://localhost/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Admin Concorrente 2',
          email: 'setup-test-race2@example.com',
          password: 'PasswordRace123!',
          setupToken: VALID_SETUP_TOKEN
        })
      }));

      const [res1, res2] = await Promise.all([p1, p2]);
      const statuses = [res1.status, res2.status].sort();

      // Exatamente um deve obter 201, o concorrente deve obter 403
      expect(statuses).toEqual([201, 403]);

      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
      expect(adminCount).toBe(1);
    } finally {
      for (const a of existingAdmins) {
        await prisma.user.upsert({ where: { id: a.id }, update: {}, create: a });
      }
    }
  });
});

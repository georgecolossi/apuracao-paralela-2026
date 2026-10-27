import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { GET, POST } from '@/app/api/setup/route';
import * as bcrypt from 'bcryptjs';

describe('PR 1 — Secure Admin Setup API (/api/setup)', () => {
  beforeEach(async () => {
    // Limpa apenas registros de teste de usuário criados para este teste
    await prisma.auditLog.deleteMany({
      where: { action: 'INITIAL_ADMIN_SETUP' }
    });
    await prisma.user.deleteMany({
      where: { email: { contains: 'setup-test' } }
    });
  });

  it('GET /api/setup informa se o sistema já possui administrador', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.isInitialized).toBe('boolean');
  });

  it('POST /api/setup valida parâmetros mínimos de nome, email e senha', async () => {
    // 1. Senha curta (< 8 chars)
    const reqShortPass = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Admin Teste',
        email: 'setup-test-short@example.com',
        password: '123'
      })
    });
    const resShort = await POST(reqShortPass);
    expect(resShort.status).toBe(400);
    const jsonShort = await resShort.json();
    expect(jsonShort.error).toMatch(/mínimo 8 caracteres/i);

    // 2. Email inválido
    const reqBadEmail = new Request('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Admin Teste',
        email: 'invalid-email',
        password: 'StrongPassword123!'
      })
    });
    const resBad = await POST(reqBadEmail);
    expect(resBad.status).toBe(400);
  });

  it('POST /api/setup cria o primeiro administrador com hash e gera AuditLog', async () => {
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
          password
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

      // Teste de proteção contra reinicialização: Segundo POST deve ser rejeitado com 403
      const reqSecond = new Request('http://localhost/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Tentativa Invasora',
          email: 'setup-test-second@example.com',
          password: 'AnotherPassword123!'
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

  it('POST /api/setup rejeita solicitação se ADMIN_SETUP_TOKEN estiver configurado e token divergir', async () => {
    process.env.ADMIN_SETUP_TOKEN = 'secret-cluster-token-xyz';

    try {
      const req = new Request('http://localhost/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Admin Token Test',
          email: 'setup-test-token@example.com',
          password: 'Password12345!',
          setupToken: 'wrong-token'
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Token de autorização de setup inválido/i);
    } finally {
      delete process.env.ADMIN_SETUP_TOKEN;
    }
  });
});

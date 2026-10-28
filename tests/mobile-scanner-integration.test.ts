import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { POST } from '../src/app/api/scan/route';
import * as auth from '../src/lib/auth';
import { generateCsrfToken } from '../src/lib/security/csrf';

const prisma = new PrismaClient();

describe('PR 5 — Mobile Scanner: Integração de API, RBAC, CSRF e Multipartes', () => {
  let adminUser: any;
  let operatorUser: any;
  let viewerUser: any;
  let twoPartPayloads: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-key-for-mobile-scanner-tests-32chars!';
    process.env.ALLOW_SIMULATED_FASE = 'true';

    // 0. Garante isolamento estrito de eleições e turnos ativos prévios
    await prisma.roundCoverage.deleteMany({});
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});

    // Cria eleição ativa com turno 1 ativo único para o pleito 2110
    await prisma.election.create({
      data: {
        slug: `election-test-scanner-${Date.now()}`,
        name: 'Eleição Teste Mobile Scanner',
        year: 2026,
        status: 'ACTIVE',
        rounds: {
          create: {
            roundNumber: 1,
            status: 'ACTIVE',
            plei: '2110',
            coverageStatus: 'PROVISIONAL'
          }
        }
      }
    });

    // 1. Cria usuários para cada perfil RBAC
    adminUser = await prisma.user.create({
      data: {
        name: 'Scanner Admin',
        email: `scanner-admin-${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'ADMIN',
        sessionVersion: 1
      }
    });

    operatorUser = await prisma.user.create({
      data: {
        name: 'Scanner Operator',
        email: `scanner-op-${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'OPERATOR',
        sessionVersion: 1
      }
    });

    viewerUser = await prisma.user.create({
      data: {
        name: 'Scanner Viewer',
        email: `scanner-view-${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'VIEWER',
        sessionVersion: 1
      }
    });

    // 2. Carrega fixture oficial multipartes (2 partes)
    const fixtureDir = path.join(
      __dirname,
      'fixtures',
      'tse-2026',
      'official',
      'examples',
      'RED_s02110ac0139200090110-imgbu',
      'decoded'
    );

    if (fs.existsSync(fixtureDir)) {
      const part1 = fs.readFileSync(path.join(fixtureDir, 'qrbu-01-of-02.txt'), 'utf8').trim();
      const part2 = fs.readFileSync(path.join(fixtureDir, 'qrbu-02-of-02.txt'), 'utf8').trim();
      twoPartPayloads = [part1, part2];
    }
  });

  afterAll(async () => {
    delete process.env.ALLOW_SIMULATED_FASE;
    // Limpeza
    await prisma.roundCoverage.deleteMany({});
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        id: { in: [adminUser?.id, operatorUser?.id, viewerUser?.id].filter(Boolean) }
      }
    });
  });

  describe('1. Segurança, Autenticação e RBAC', () => {
    it('1.1 Rejeita requisição não autenticada com HTTP 401', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: false,
        reason: 'UNAUTHENTICATED'
      } as any);

      const req = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          content: twoPartPayloads[0] || 'QRBU:1:1:1:2:SC:1:1:1:TEST',
          sessionId: `TEST-SESSION-${Date.now()}`
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Não autorizado');
    });

    it('1.2 Rejeita perfil VIEWER com HTTP 403 e código FORBIDDEN_ROLE', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: viewerUser.id, role: 'VIEWER', sessionVersion: viewerUser.sessionVersion }
      } as any);

      const req = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          content: twoPartPayloads[0] || 'QRBU:1:1:1:2:SC:1:1:1:TEST',
          sessionId: `TEST-SESSION-${Date.now()}`
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('FORBIDDEN_ROLE');
    });

    it('1.3 Rejeita requisição de mutação sem validação CSRF com HTTP 403', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUser.id, role: 'OPERATOR', sessionVersion: operatorUser.sessionVersion }
      } as any);

      // Requisição cruzada vinda de origem não confiável
      const req = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil-attacker.com'
        },
        body: JSON.stringify({
          content: twoPartPayloads[0] || 'QRBU:1:1:1:2:SC:1:1:1:TEST',
          sessionId: `TEST-SESSION-${Date.now()}`
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('CSRF');
    });

    it('1.4 Aceita requisição de OPERATOR com CSRF Token válido', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUser.id, role: 'OPERATOR', sessionVersion: operatorUser.sessionVersion }
      } as any);

      const validToken = generateCsrfToken(operatorUser.id, operatorUser.sessionVersion);

      const sessionId = `MOB-OP-CSRF-${Date.now()}`;
      const req = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          Host: 'localhost',
          'X-CSRF-Token': validToken
        },
        body: JSON.stringify({
          content: twoPartPayloads[0],
          sessionId
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('PARCIAL');
      expect(data.partsRead).toBe(1);
    });
  });

  describe('2. Ingestão Multipartes: Ordem Normal vs Fora de Ordem', () => {
    it('2.1 Ingestão fora de ordem: Parte 2 recebida antes da Parte 1', async () => {
      expect(twoPartPayloads.length).toBe(2);

      const sessionId = `OUT-OF-ORDER-${Date.now()}`;

      // Etapa 1: Envia Parte 2
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUser.id, role: 'OPERATOR', sessionVersion: operatorUser.sessionVersion }
      } as any);

      const validToken = generateCsrfToken(operatorUser.id, operatorUser.sessionVersion);

      const reqPart2 = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          Host: 'localhost',
          'X-CSRF-Token': validToken
        },
        body: JSON.stringify({
          content: twoPartPayloads[1], // Parte 2 enviada primeiro!
          sessionId
        })
      });

      const res2 = await POST(reqPart2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.status).toBe('PARCIAL');
      expect(data2.partIndex).toBe(2);
      expect(data2.totalParts).toBe(2);
      expect(data2.partsRead).toBe(1);

      // Etapa 2: Envia Parte 1 (completa o envelope)
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUser.id, role: 'OPERATOR', sessionVersion: operatorUser.sessionVersion }
      } as any);

      const reqPart1 = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          Host: 'localhost',
          'X-CSRF-Token': validToken
        },
        body: JSON.stringify({
          content: twoPartPayloads[0], // Parte 1 enviada em seguida
          sessionId
        })
      });

      const res1 = await POST(reqPart1);
      // Deve processar com 200 (se a eleição/cobertura estiver ativa para os cargos)
      // Ou 403 OUT_OF_COVERAGE / 422 OFFICE_NOT_CONFIGURED se não cadastrado na cobertura padrão de teste,
      // mas NUNCA 500 ou falha de reconstrução de partes!
      expect([200, 403, 422]).toContain(res1.status);

      if (res1.status === 200) {
        const data1 = await res1.json();
        expect(data1.status).toBe('COMPLETO');
        expect(data1.reportId).toBeDefined();
      } else {
        const errData = await res1.json();
        // Confirma que a falha é de contexto/cobertura eleitoral, não de ordem de partes
        expect(['OUT_OF_COVERAGE', 'OFFICE_NOT_CONFIGURED']).toContain(errData.error);
      }
    });

    it('2.2 Deduplicação no Backend: Envio repetido da mesma parte na mesma sessão', async () => {
      const sessionId = `DEDUP-TEST-${Date.now()}`;
      const validToken = generateCsrfToken(operatorUser.id, operatorUser.sessionVersion);

      // 1ª vez: Parte 1
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUser.id, role: 'OPERATOR', sessionVersion: operatorUser.sessionVersion }
      } as any);

      const req1 = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          Host: 'localhost',
          'X-CSRF-Token': validToken
        },
        body: JSON.stringify({ content: twoPartPayloads[0], sessionId })
      });

      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // 2ª vez: Mesma Parte 1 (simulando múltiplos disparos de frame da câmera)
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUser.id, role: 'OPERATOR', sessionVersion: operatorUser.sessionVersion }
      } as any);

      const req2 = new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          Host: 'localhost',
          'X-CSRF-Token': validToken
        },
        body: JSON.stringify({ content: twoPartPayloads[0], sessionId })
      });

      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      // Não duplica: continua marcando partsRead = 1
      expect(data2.partsRead).toBe(1);
    });
  });
});

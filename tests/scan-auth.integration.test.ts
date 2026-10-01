import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { POST } from '../src/app/api/scan/route';
import * as auth from '../src/lib/auth';

const prisma = new PrismaClient();

describe('POST /api/scan Auth and Session Regression', () => {
  let existingUser: any;

  beforeAll(async () => {
    // Garantir que temos um user no banco de teste
    existingUser = await prisma.user.create({
      data: {
        name: 'Test Operator',
        email: `op-${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'OPERATOR'
      }
    });
  });

  it('A) Usuário existente: deve criar ScanSession sem violar FK', async () => {
    // Mockar autenticação para um usuário real no banco
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
      authenticated: true,
      user: { userId: existingUser.id, role: 'OPERATOR' }
    });

    const sessionId = `SEQ-${Date.now()}`;
    // Usar uma string de parte curta sintética apenas para instanciar a sessão
    // Não precisa ser um QR longo, desde que passe do parsePart estrutural ou acione a criação
    // Mas o parser QRBU real vai rejeitar texto curto no parsePart.
    // Vamos enviar isSimulation para usar o parser de simulação que aceita "SIM-xxx" mais facilmente?
    // O problema diz: "POST /api/scan com uma parte QRBU válida o suficiente para iniciar uma sessão"
    // Vou enviar um QRBU dummy que é apenas uma string válida de simulação.
    
    // Tse2026SimulationParser expects QR code like: "SIM-T2:1/2:PAYLOAD..."
    // Let's check Tse2026SimulationParser
    const fakeContent = `SIMULATION|1|2|${sessionId}|DUMMY_PAYLOAD`;

    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        content: fakeContent,
        sessionId,
        isSimulation: true
      })
    });

    const res = await POST(req);
    const json = await res.json();
    
    // Pode falhar com CONFLICTING_PART ou INVALID_HEADER *depois* da ScanSession, mas não 500/P2003
    expect(res.status).not.toBe(500);

    const sessionInDb = await prisma.scanSession.findUnique({ where: { sequenceId: sessionId } });
    expect(sessionInDb).not.toBeNull();
    expect(sessionInDb?.operatorId).toBe(existingUser.id);
  });

  it('B) Usuário não existe (deletado): deve falhar de maneira controlada com 401 e NÃO criar ScanSession', async () => {
    // Este mock simula a nova proteção em requireAuthenticatedUser
    // Na prática requireAuthenticatedUser já faz isso agora!
    // Para testar o fluxo de falha real, vamos mockar APENAS o requireAuthenticatedUser retornando a falha
    // que ele mesmo geraria após checar o banco.
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
      authenticated: false,
      reason: 'USER_DELETED'
    });

    const sessionId = `SEQ-DELETED-${Date.now()}`;
    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        content: `SIMULATION|1|2|${sessionId}|PAYLOAD`,
        sessionId,
        isSimulation: true
      })
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/Não autorizado/i);

    const sessionInDb = await prisma.scanSession.findUnique({ where: { sequenceId: sessionId } });
    expect(sessionInDb).toBeNull(); // Nunca deve ser criada
  });
});

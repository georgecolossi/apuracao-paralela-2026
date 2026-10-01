import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { POST } from '../src/app/api/scan/route';
import * as auth from '../src/lib/auth';

const prisma = new PrismaClient();

describe('POST /api/scan Idempotência e Concorrência na Recepção', () => {
  let existingUser: any;

  beforeAll(async () => {
    existingUser = await prisma.user.create({
      data: {
        name: 'Test Operator Idempotency',
        email: `op-idem-${Date.now()}@test.com`,
        passwordHash: 'hash',
        role: 'OPERATOR'
      }
    });
  });

  // Helper para simular Request POST autenticado
  const createMockRequest = (sessionId: string, payload: string) => {
    return new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        content: `SIMULATION|1|2|${sessionId}|${payload}`,
        sessionId,
        isSimulation: true
      })
    });
  };

  const getParts = async (sequenceId: string) => {
    const session = await prisma.scanSession.findUnique({ where: { sequenceId } });
    if (!session) return [];
    return prisma.ballotReportPart.findMany({ where: { sessionId: session.id } });
  };

  it('1. PRIMEIRA PARTE: deve criar exatamente 1 BallotReportPart', async () => {
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: { userId: existingUser.id, role: 'OPERATOR' }
    });

    const sessionId = `SEQ-IDEM-1-${Date.now()}`;
    const res = await POST(createMockRequest(sessionId, 'PAYLOAD_A'));
    const json = await res.json();
    
    expect(res.status).not.toBe(500);

    const parts = await getParts(sessionId);
    expect(parts.length).toBe(1);
    expect(parts[0].rawContent).toContain('PAYLOAD_A');
  });

  it('2. DUPLICATA SEQUENCIAL: enviar a mesma parte duas vezes deve tratar idempontentemente', async () => {
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: { userId: existingUser.id, role: 'OPERATOR' }
    });

    const sessionId = `SEQ-IDEM-2-${Date.now()}`;
    
    // Request 1
    const res1 = await POST(createMockRequest(sessionId, 'PAYLOAD_B'));
    expect(res1.status).not.toBe(500);

    // Request 2 (idêntico sequencial)
    const res2 = await POST(createMockRequest(sessionId, 'PAYLOAD_B'));
    expect(res2.status).not.toBe(500);
    expect(res2.status).not.toBe(409); // Não deve dar conflito

    const parts = await getParts(sessionId);
    expect(parts.length).toBe(1);
  });

  it('3. DUPLICATA CONCORRENTE: race condition não deve retornar 500 nem criar duplicatas', async () => {
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: { userId: existingUser.id, role: 'OPERATOR' }
    });

    const sessionId = `SEQ-IDEM-3-${Date.now()}`;

    // Dispara requests paralelos para explorar TOCTOU (Time of Check, Time of Use)
    const requests = [
      POST(createMockRequest(sessionId, 'PAYLOAD_C')),
      POST(createMockRequest(sessionId, 'PAYLOAD_C')),
      POST(createMockRequest(sessionId, 'PAYLOAD_C'))
    ];

    const responses = await Promise.all(requests);

    responses.forEach(res => {
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(409); // Nenhuma deve dar conflito se são idênticas
    });

    const parts = await getParts(sessionId);
    expect(parts.length).toBe(1);
  });

  it('4. CONFLITO DE CONTEÚDO: mesmo índice, conteúdo diferente deve rejeitar a segunda com 409', async () => {
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: { userId: existingUser.id, role: 'OPERATOR' }
    });

    const sessionId = `SEQ-IDEM-4-${Date.now()}`;
    
    // Request 1
    await POST(createMockRequest(sessionId, 'PAYLOAD_X'));

    // Request 2 (diferente)
    const res2 = await POST(createMockRequest(sessionId, 'PAYLOAD_Y'));
    
    expect(res2.status).toBe(409);
    const json = await res2.json();
    expect(json.error).toBe('CONFLICTING_PART');

    // A original ainda deve ser a PAYLOAD_X
    const parts = await getParts(sessionId);
    expect(parts.length).toBe(1);
    expect(parts[0].rawContent).toContain('PAYLOAD_X');
  });
});

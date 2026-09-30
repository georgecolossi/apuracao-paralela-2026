import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Gerenciamento de ScanSession', () => {
  it('Não deve aceitar a mesma parte de um QR Code duas vezes', async () => {
    const session = await prisma.scanSession.create({
      data: { sequenceId: `SEQ-TEST-${Date.now()}`, expectedParts: 3 }
    });

    await prisma.ballotReportPart.create({
      data: { sessionId: session.id, partIndex: 1, totalParts: 3, rawContent: 'parte1', contentHash: 'hash1' }
    });

    let error: unknown = null;
    try {
      await prisma.ballotReportPart.create({
        data: { sessionId: session.id, partIndex: 1, totalParts: 3, rawContent: 'parte1_dup', contentHash: 'hash1_dup' }
      });
    } catch (e: unknown) {
      error = e;
    }

    // Espera falha de UNIQUE constraint em sessionId_partIndex
    expect(error).not.toBeNull();
    expect((error as { code: string }).code).toBe('P2002');
  });
});

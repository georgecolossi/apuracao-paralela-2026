import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Integração de Banco de Dados e Concorrência', () => {
  let electionId: string;
  let roundId: string;

  beforeAll(async () => {
    let election = await prisma.election.findFirst({ include: { rounds: true }});
    if (!election) {
      election = await prisma.election.create({
        data: {
          plei: 'INTEG',
          name: 'Teste Concorrência',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }] }
        },
        include: { rounds: true }
      });
    }
    electionId = election.id;
    roundId = election.rounds[0].id;
  });

  it('Deduplicação de BUs via Constraints (UNIQUE deterministicId)', async () => {
    const fakeId = `TEST-DUP-${Date.now()}`;
    
    // Inserção do Operador A
    const reportA = await prisma.ballotReport.create({
      data: {
        deterministicId: fakeId,
        electionId,
        roundId: roundId,
        stateCode: 'SP',
        cityCode: '123',
        zoneCode: '1',
        sectionCode: '1',
        urnCode: 'U1',
        status: 'PROCESSADO'
      }
    });

    // Inserção do Operador B (Simultâneo/Sequencial do mesmo BU)
    let errorCatcher: any = null;
    try {
      await prisma.ballotReport.create({
        data: {
          deterministicId: fakeId,
          electionId,
          roundId: roundId,
          stateCode: 'SP',
          cityCode: '123',
          zoneCode: '1',
          sectionCode: '1',
          urnCode: 'U1',
          status: 'PROCESSADO'
        }
      });
    } catch (e: any) {
      errorCatcher = e;
    }

    // Deve lançar erro P2002 de Unique Constraint
    expect(errorCatcher).not.toBeNull();
    expect(errorCatcher.code).toBe('P2002');
  });

  it('Cálculo Dinâmico (Recálculo) ignora BUs cancelados', async () => {
    const office = await prisma.office.create({ data: { name: 'CargoTeste', orderNumber: 99 }});
    const fakeId1 = `TEST-CALC1-${Date.now()}`;
    const fakeId2 = `TEST-CALC2-${Date.now()}`;

    // BU Válido
    await prisma.ballotReport.create({
      data: {
        deterministicId: fakeId1,
        electionId,
        roundId: roundId,
        stateCode: 'SP', cityCode: '1', zoneCode: '1', sectionCode: '1', urnCode: 'U1',
        status: 'PROCESSADO',
        votes: { create: [{ officeId: office.id, voteType: 'NOMINAL', quantity: 10 }] }
      }
    });

    // BU Cancelado/Duplicado
    await prisma.ballotReport.create({
      data: {
        deterministicId: fakeId2,
        electionId,
        roundId: roundId,
        stateCode: 'SP', cityCode: '1', zoneCode: '1', sectionCode: '2', urnCode: 'U2',
        status: 'CANCELADO',
        votes: { create: [{ officeId: office.id, voteType: 'NOMINAL', quantity: 50 }] } // não deve contar
      }
    });

    // Recálculo direto (Aggregator query simulada)
    const rawTotals = await prisma.ballotVote.groupBy({
      by: ['officeId'],
      where: {
        report: { status: 'PROCESSADO' },
        officeId: office.id
      },
      _sum: { quantity: true }
    });

    expect(rawTotals.length).toBe(1);
    expect(rawTotals[0]._sum.quantity).toBe(10); // Ignorou os 50 do cancelado
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('Apuracao - Integracao Legenda e Nulos', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = new PrismaClient(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('C) Federal: total legenda = 1359', async () => {
    const federal = await prisma.ballotVote.aggregate({
      where: { office: { name: 'Deputado Federal' }, voteType: 'LEGENDA' },
      _sum: { quantity: true }
    });
    if (federal._sum.quantity !== null) { expect(federal._sum.quantity).toBe(1359); }
  });

  it('D) Estadual: total legenda = 2809', async () => {
    const estadual = await prisma.ballotVote.aggregate({
      where: { office: { name: 'Deputado Estadual' }, voteType: 'LEGENDA' },
      _sum: { quantity: true }
    });
    if (estadual._sum.quantity !== null) { expect(estadual._sum.quantity).toBe(2809); }
  });
});
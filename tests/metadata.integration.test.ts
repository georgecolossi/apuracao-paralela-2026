import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { CandidateResolver } from '../src/lib/metadata/CandidateResolver';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('Candidate Metadata Integration', () => {
  beforeAll(async () => {
    // Roda o importer
    execSync('npm run import:candidates', { stdio: 'ignore' });
  });

  afterAll(async () => {
    // Limpa a tabela para não sujar os outros testes
    await prisma.candidateMetadata.deleteMany();
    await prisma.$disconnect();
  });

  it('deve ter importado presidente do BR.csv e cargos do SC.csv', async () => {
    const brCount = await prisma.candidateMetadata.count({ where: { state: 'BR', officeCode: '1' } });
    const scCount = await prisma.candidateMetadata.count({ where: { state: 'SC' } });
    
    expect(brCount).toBeGreaterThan(0);
    expect(scCount).toBeGreaterThan(0);

    // Nao deve ter cargos invalidos importados
    const invalidCount = await prisma.candidateMetadata.count({
      where: { officeCode: { notIn: ['1', '3', '5', '6', '7'] } }
    });
    expect(invalidCount).toBe(0);
  });

  it('resolver deve retornar FOUND para Presidente (Cargo 1) e retornar nome e partido', async () => {
    const resolver = new CandidateResolver();
    await resolver.load('', 'BR');

    // Supondo que 28 seja o número importado para Presidente no dataset BR
    const candidateNumber = '22';
    const result = resolver.resolveNominal('1', candidateNumber);

    expect(result.status).toBe('FOUND');
    expect(result.candidateName).toBeTruthy();
    expect(result.partyAbbreviation).toBe('PL');
    expect(result.partyNumber).toBe('22');
  });

  it('resolver deve retornar NOT_FOUND para candidato inexistente', async () => {
    const resolver = new CandidateResolver();
    await resolver.load('', 'BR');

    const result = resolver.resolveNominal('1', '99999');
    expect(result.status).toBe('NOT_FOUND');
  });

  it('resolver deve retornar AMBIGUOUS para candidato duplicado na mesma chave', async () => {
    // Inserimos uma duplicidade artificial com SQ_CANDIDATO diferente
    await prisma.candidateMetadata.create({
      data: {
        candidateSequence: '99999999999',
        electionYear: 2026,
        electionCode: '',
        round: 1,
        state: 'SC',
        officeCode: '3',
        officeName: 'GOVERNADOR',
        candidateNumber: '99',
        ballotName: 'FALSO GOVERNADOR',
        partyNumber: '99',
        partyAbbreviation: 'FALSO',
        partyName: 'PARTIDO FALSO'
      }
    });
    
    await prisma.candidateMetadata.create({
      data: {
        candidateSequence: '88888888888',
        electionYear: 2026,
        electionCode: '',
        round: 1,
        state: 'SC',
        officeCode: '3',
        officeName: 'GOVERNADOR',
        candidateNumber: '99',
        ballotName: 'FALSO GOVERNADOR 2',
        partyNumber: '99',
        partyAbbreviation: 'FALSO',
        partyName: 'PARTIDO FALSO'
      }
    });

    const resolver = new CandidateResolver();
    await resolver.load('', 'SC');

    const result = resolver.resolveNominal('3', '99');
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.candidateName).toBeUndefined(); // Não escolhe arbitrariamente
  });
});

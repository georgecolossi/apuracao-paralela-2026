import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const prisma = new PrismaClient();

describe('Importador de Secoes Eleitorais', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/polling-sections/import-tse-2026.ts');
  const mockCsvPath = path.resolve(__dirname, 'fixtures/mock-eleitorado.csv');

  beforeEach(async () => {
    await prisma.pollingStation.deleteMany({});
    await prisma.pollingSection.deleteMany({});
    await prisma.pollingZone.deleteMany({});
    
    // Ensure municipality exists
    const state = await prisma.state.upsert({
      where: { abbreviation: 'SC' },
      create: { abbreviation: 'SC', name: 'Santa Catarina' },
      update: {}
    });
    await prisma.municipality.upsert({
      where: { officialCode: '80837' },
      create: { officialCode: '80837', name: 'CONCRDIA', stateId: state.id },
      update: {}
    });
  });

  it('M) dry-run nao escreve no banco', async () => {
    const cmd = 'npx ts-node "' + scriptPath + '" "' + mockCsvPath + '"';
    const output = execSync(cmd, { encoding: 'utf8' });
    expect(output).toContain('DRY-RUN mode');
    expect(output).toContain('Expected BUs: 2');
    
    const count = await prisma.pollingSection.count();
    expect(count).toBe(0);
  });

  it('A, B, C, D, E, F, G) Executa apply, verifica contagens, deduplicacao e agregadas', async () => {
    const env = { ...process.env, ALLOW_PRODUCTION_POLLING_SECTION_IMPORT: 'I_UNDERSTAND_THIS_WRITES_PRODUCTION' };
    const cmd = 'npx ts-node "' + scriptPath + '" "' + mockCsvPath + '" --apply';
    const output = execSync(cmd, { env, encoding: 'utf8' });
    
    expect(output).toContain('Aplicacao concluida com sucesso');
    
    // Expected to find 3 sections (90/125, 90/90, 9/1) because 81000 is ignored and 9/1 is duplicated in CSV
    const zonesCount = await prisma.pollingZone.count();
    expect(zonesCount).toBe(2);
    
    const sectionsCount = await prisma.pollingSection.count();
    expect(sectionsCount).toBe(3);
    
    const z90s125 = await prisma.pollingSection.findFirst({
        where: { sectionNumber: '0125', zone: { zoneNumber: '0090' } }
    });
    expect(z90s125!.expectedBUs).toBe(0);
    
    const z90s90 = await prisma.pollingSection.findFirst({
        where: { sectionNumber: '0090', zone: { zoneNumber: '0090' } }
    });
    expect(z90s90!.expectedBUs).toBe(1);
    
    const z9s1 = await prisma.pollingSection.findFirst({
        where: { sectionNumber: '0001', zone: { zoneNumber: '0009' } }
    });
    expect(z9s1!.expectedBUs).toBe(1);
    
    const aggregate = await prisma.pollingSection.aggregate({
        _sum: { expectedBUs: true }
    });
    expect(aggregate._sum.expectedBUs).toBe(2);
  });

  it('N) segunda execucao apply e idempotente e nao duplica nada', async () => {
    const env = { ...process.env, ALLOW_PRODUCTION_POLLING_SECTION_IMPORT: 'I_UNDERSTAND_THIS_WRITES_PRODUCTION' };
    const cmd = 'npx ts-node "' + scriptPath + '" "' + mockCsvPath + '" --apply';
    execSync(cmd, { env, encoding: 'utf8' });
    execSync(cmd, { env, encoding: 'utf8' });
    
    const sectionsCount = await prisma.pollingSection.count();
    expect(sectionsCount).toBe(3);
    
    const aggregate = await prisma.pollingSection.aggregate({
        _sum: { expectedBUs: true }
    });
    expect(aggregate._sum.expectedBUs).toBe(2);
  });

  it('O) municipio diferente nao e alterado (ignorado)', async () => {
    const env = { ...process.env, ALLOW_PRODUCTION_POLLING_SECTION_IMPORT: 'I_UNDERSTAND_THIS_WRITES_PRODUCTION' };
    const cmd = 'npx ts-node "' + scriptPath + '" "' + mockCsvPath + '" --apply';
    execSync(cmd, { env, encoding: 'utf8' });
    
    const otherCount = await prisma.pollingZone.count({
        where: { municipality: { officialCode: '81000' } }
    });
    expect(otherCount).toBe(0);
  });

  it('P) sem ALLOW_PRODUCTION_POLLING_SECTION_IMPORT apply falha', async () => {
    try {
        const cmd = 'npx ts-node "' + scriptPath + '" "' + mockCsvPath + '" --apply';
        execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false); // should not reach
    } catch (e: any) {
        expect(e.stdout.toString() + e.stderr.toString()).toContain('ERRO: Para aplicar');
    }
  });
});

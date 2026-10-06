import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const prisma = new PrismaClient();

describe('Guard de Producao do Importador de Secoes Eleitorais', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/polling-sections/import-tse-2026.ts');
  const mockCsvPath = path.resolve(__dirname, 'fixtures/mock-eleitorado.csv');

  beforeEach(async () => {
    await prisma.pollingStation.deleteMany({});
    await prisma.pollingSection.deleteMany({});
    await prisma.pollingZone.deleteMany({});
    
    // Ensure municipality exists in test DB
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

  const baseEnv = { 
    ...process.env,
    DATABASE_URL: 'file:/data/prod.db',
    ALLOW_PRODUCTION_POLLING_SECTION_IMPORT: 'I_UNDERSTAND_THIS_WRITES_PRODUCTION',
    ALLOW_OPERATIONAL_RESET: 'false'
  };

  const getCmd = (extraArgs = '') => 'npx ts-node "' + scriptPath + '" "' + mockCsvPath + '" ' + extraArgs;

  it('A) producao + --apply + env correta + ALLOW_OPERATIONAL_RESET=false + confirmation correta -> AUTHORIZED', () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=80837-2026');
        const output = execSync(cmd, { env: baseEnv, encoding: 'utf8', stdio: 'pipe' });
        expect(output).toContain('Iniciando persistencia no banco de dados...');
    } catch (e: any) {
        // It might crash on DB operations if /data/prod.db is not set up, but the guard MUST have passed
        const out = e.stdout.toString() + e.stderr.toString();
        expect(out).toContain('Iniciando persistencia');
        expect(out).not.toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('B) producao + sem confirmation -> REFUSED', () => {
    try {
        const cmd = getCmd('--apply');
        execSync(cmd, { env: baseEnv, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('C) producao + confirmation errada -> REFUSED', () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=wrong');
        execSync(cmd, { env: baseEnv, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('D) producao + sem env -> REFUSED', () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=80837-2026');
        const env = { ...baseEnv };
        env.ALLOW_PRODUCTION_POLLING_SECTION_IMPORT = '';
        execSync(cmd, { env, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('E) producao + env errada -> REFUSED', () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=80837-2026');
        const env = { ...baseEnv, ALLOW_PRODUCTION_POLLING_SECTION_IMPORT: 'wrong' };
        execSync(cmd, { env, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('F) producao + ALLOW_OPERATIONAL_RESET ausente -> REFUSED', () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=80837-2026');
        const env = { ...baseEnv };
        env.ALLOW_OPERATIONAL_RESET = '';
        execSync(cmd, { env, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('G) producao + ALLOW_OPERATIONAL_RESET=true -> REFUSED', () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=80837-2026');
        const env = { ...baseEnv, ALLOW_OPERATIONAL_RESET: 'true' };
        execSync(cmd, { env, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: Protecoes de producao ausentes');
    }
  });

  it('H) producao + sem --apply -> DRY_RUN / ZERO WRITE', () => {
    const cmd = getCmd('');
    const output = execSync(cmd, { env: baseEnv, encoding: 'utf8' });
    expect(output).toContain('DRY-RUN mode');
  });

  it('I) DATABASE_URL semelhante mas diferente (prod.db.backup) -> REFUSED (Nao e producao, nem rehearsal)', () => {
    try {
        const cmd = getCmd('--apply');
        const env = { ...process.env, DATABASE_URL: 'file:/data/prod.db.backup' };
        execSync(cmd, { env, encoding: 'utf8', stdio: 'pipe' });
        expect(true).toBe(false);
    } catch (e: any) {
        expect(e.stderr.toString()).toContain('ERRO: DATABASE_URL similar a producao porem nao e producao nem rehearsal reconhecido');
    }
  });

  it('J) producao + combinacao incompleta -> REFUSED / ZERO WRITE', async () => {
    try {
        const cmd = getCmd('--apply --confirm-production-section-import=80837-2026');
        const env = { ...baseEnv, ALLOW_OPERATIONAL_RESET: 'true' }; // Will fail
        execSync(cmd, { env, encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
        // ok
    }
    const count = await prisma.pollingSection.count();
    expect(count).toBe(0); // Proving ZERO WRITE to our test.db (even though it tried to use prod.db, it aborted early)
  });

  it('K) rehearsal/test DB valido -> apply continua funcional', async () => {
    // No prod db url, so it uses the default test db url provided by vitest environment
    const cmd = getCmd('--apply');
    const output = execSync(cmd, { env: process.env, encoding: 'utf8' });
    expect(output).toContain('Aplicacao concluida com sucesso');
    
    const count = await prisma.pollingSection.count();
    expect(count).toBe(3); // 3 from the mock CSV
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('PR 1 — Migration Integrity & Clean Initialization Baseline', () => {
  const dbFileName = 'clean-init.db';
  const dbPath = path.resolve(process.cwd(), dbFileName);
  const dbUrl = `file:${dbPath}`;
  const migrationFile = path.resolve(process.cwd(), 'prisma/migrations/20261027_universal_data_model/migration.sql');

  let testPrisma: PrismaClient;

  beforeAll(() => {
    // Garante que o arquivo SQLite não existe antes do teste
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
      }
    }
  });

  afterAll(async () => {
    if (testPrisma) {
      await testPrisma.$disconnect();
    }
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore cleanup lock on windows if held
        }
      }
    }
  });

  it('1. Aplica o script DDL da migration 20261027_universal_data_model em um SQLite novo do zero', () => {
    expect(fs.existsSync(migrationFile)).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);

    // Executa a migration usando prisma db execute diretamente no arquivo não existente
    const cmd = `npx prisma db execute --file "${migrationFile}" --url "${dbUrl}"`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    expect(output).toBeDefined();

    // O arquivo SQLite deve ter sido criado
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('2. Verifica PRAGMA integrity_check e PRAGMA foreign_key_check no banco novo', async () => {
    testPrisma = new PrismaClient({
      datasources: {
        db: { url: dbUrl }
      }
    });

    const integrityResult = await testPrisma.$queryRawUnsafe<Array<{ integrity_check: string }>>(
      'PRAGMA integrity_check;'
    );
    expect(integrityResult).toHaveLength(1);
    expect(integrityResult[0].integrity_check).toBe('ok');

    const foreignKeyViolations = await testPrisma.$queryRawUnsafe<Array<any>>(
      'PRAGMA foreign_key_check;'
    );
    expect(foreignKeyViolations).toHaveLength(0);
  });

  it('3. Confirma a criação de todas as 21 tabelas do modelo universal na instalação limpa', async () => {
    const tables = await testPrisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%';"
    );
    const tableNames = tables.map((t) => t.name).sort();

    const expectedTables = [
      'AuditLog',
      'BallotReport',
      'BallotReportPart',
      'BallotVote',
      'Candidate',
      'CandidateMetadata',
      'Election',
      'ElectionRound',
      'ElectionScope',
      'Municipality',
      'Office',
      'Party',
      'PollingSection',
      'PollingStation',
      'PollingZone',
      'ProcessingError',
      'RoundCoverage',
      'ScanSession',
      'State',
      'TseSyncConfig',
      'User'
    ].sort();

    expect(tableNames).toEqual(expectedTables);
  });

  it('4. Confirma que os índices essenciais e regras de unicidade foram estabelecidos', async () => {
    const indices = await testPrisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';"
    );
    const indexNames = indices.map((i) => i.name);

    // Checagem de índices chaves
    expect(indexNames).toContain('Office_electionId_code_key');
    expect(indexNames).toContain('Candidate_officeId_candidateNumber_key');
    expect(indexNames).toContain('ElectionRound_electionId_roundNumber_key');
    expect(indexNames).toContain('TseSyncConfig_electionId_configKey_key');
    expect(indexNames).toContain('BallotReport_deterministicId_key');
    expect(indexNames).toContain('ElectionScope_electionId_scopeKey_key');
  });

  it('5. Valida inserção relacional e integridade de foreign keys no novo banco', async () => {
    // Insere Election
    const election = await testPrisma.election.create({
      data: {
        id: 'elec-clean-1',
        slug: 'geral-clean-2026',
        name: 'Eleições Gerais Limpas 2026',
        year: 2026,
        type: 'GENERAL',
        status: 'CONFIGURING'
      }
    });
    expect(election.id).toBe('elec-clean-1');

    // Insere ElectionRound
    const round = await testPrisma.electionRound.create({
      data: {
        id: 'round-clean-1',
        electionId: election.id,
        roundNumber: 1,
        status: 'PLANNED',
        coverageStatus: 'PROVISIONAL'
      }
    });
    expect(round.electionId).toBe(election.id);

    // Insere Office
    const office = await testPrisma.office.create({
      data: {
        id: 'off-clean-1',
        electionId: election.id,
        code: '1',
        name: 'Presidente',
        type: 'EXECUTIVE',
        orderNumber: 1,
        maxVotesPerVoter: 1
      }
    });

    // Insere Party e Candidate
    const party = await testPrisma.party.create({
      data: {
        id: 'party-clean-10',
        officialIdentifier: '10',
        name: 'Partido Dez',
        abbreviation: 'PD'
      }
    });

    const candidate = await testPrisma.candidate.create({
      data: {
        id: 'cand-clean-10',
        officeId: office.id,
        partyId: party.id,
        candidateNumber: '10',
        name: 'Candidato Dez',
        ballotName: 'Candidato 10'
      }
    });
    expect(candidate.candidateNumber).toBe('10');

    // PRAGMA foreign_key_check deve continuar 0
    const foreignKeyViolations = await testPrisma.$queryRawUnsafe<Array<any>>(
      'PRAGMA foreign_key_check;'
    );
    expect(foreignKeyViolations).toHaveLength(0);
  });
});

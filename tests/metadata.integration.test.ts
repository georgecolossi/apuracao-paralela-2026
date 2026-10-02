import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { CandidateResolver } from '../src/lib/metadata/CandidateResolver';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const brPath = path.join(__dirname, '../consulta_cand_2026/consulta_cand_2026_BR.csv');
const scPath = path.join(__dirname, '../consulta_cand_2026/consulta_cand_2026_SC.csv');
const backupBrPath = brPath + '.bak';
const backupScPath = scPath + '.bak';

describe('Candidate Metadata Integration', () => {
  beforeAll(() => {
    execSync('npm run import:candidates', { stdio: 'ignore' });
  });

  afterAll(async () => {
    await prisma.candidateMetadata.deleteMany();
    await prisma.$disconnect();
  });

  it('deve ter importado presidente do BR.csv e cargos do SC.csv', async () => {
    const brCount = await prisma.candidateMetadata.count({ where: { state: 'BR', officeCode: '1' } });
    const scCount = await prisma.candidateMetadata.count({ where: { state: 'SC' } });
    expect(brCount).toBeGreaterThan(0);
    expect(scCount).toBeGreaterThan(0);
    const invalidCount = await prisma.candidateMetadata.count({
      where: { officeCode: { notIn: ['1', '3', '5', '6', '7'] } }
    });
    expect(invalidCount).toBe(0);
  });

  it('Presidente: contexto BR, número real -> FOUND, nome de urna, sigla correta', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'BR', '1', '13');
    expect(result.status).toBe('FOUND');
    expect(result.candidateName).toBe('LULA');
    expect(result.partyAbbreviation).toBe('PT');
    expect(result.partyNumber).toBe('13');
  });

  it('Governador SC: número real -> FOUND', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'SC', '3', '22');
    expect(result.status).toBe('FOUND');
    expect(result.candidateName).toBe('JORGINHO MELLO');
  });

  it('Senador SC: número real -> FOUND', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'SC', '5', '221');
    expect(result.status).toBe('FOUND');
    expect(result.candidateName).toBe('CAROL DE TONI');
  });

  it('Deputado Federal SC: número real -> FOUND', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'SC', '6', '2233');
    expect(result.status).toBe('FOUND');
    expect(result.candidateName).toBe('JULIA ZANATTA');
  });

  it('Deputado Estadual SC: número real -> FOUND', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'SC', '7', '15123');
    expect(result.status).toBe('FOUND');
    expect(result.candidateName).toBe('ADILSON GIRARDI');
  });

  it('LEGENDA SC: partido existente -> sigla correta', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveLegenda(2026, 'SC', '6', '15');
    expect(result.status).toBe('FOUND');
    expect(result.partyAbbreviation).toBe('MDB');
  });

  it('número inexistente -> NOT_FOUND', async () => {
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'BR', '1', '99999');
    expect(result.status).toBe('NOT_FOUND');
    expect(result.candidateName).toBeUndefined(); // preserva comportamento: não inventa
  });

  it('chave deliberadamente ambígua -> AMBIGUOUS', async () => {
    await prisma.candidateMetadata.create({
      data: {
        candidateSequence: '99999999999', electionYear: 2026, electionCode: '', round: 1, state: 'SC', officeCode: '3', officeName: 'GOVERNADOR', candidateNumber: '99', ballotName: 'FALSO GOVERNADOR', partyNumber: '99', partyAbbreviation: 'FALSO', partyName: 'PARTIDO FALSO', source: 'test'
      }
    });
    await prisma.candidateMetadata.create({
      data: {
        candidateSequence: '88888888888', electionYear: 2026, electionCode: '', round: 1, state: 'SC', officeCode: '3', officeName: 'GOVERNADOR', candidateNumber: '99', ballotName: 'FALSO GOVERNADOR 2', partyNumber: '99', partyAbbreviation: 'FALSO', partyName: 'PARTIDO FALSO', source: 'test'
      }
    });
    const resolver = new CandidateResolver();
    await resolver.load(2026);
    const result = resolver.resolveNominal(2026, 'SC', '3', '99');
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.candidateName).toBeUndefined();
  });
});

describe('Importer Fail-Closed', () => {
  afterAll(() => {
    if (fs.existsSync(backupBrPath) && !fs.existsSync(brPath)) fs.renameSync(backupBrPath, brPath);
    if (fs.existsSync(backupScPath) && !fs.existsSync(scPath)) fs.renameSync(backupScPath, scPath);
  });

  it('deve falhar se BR.csv estiver ausente', () => {
    fs.renameSync(brPath, backupBrPath);
    expect(() => execSync('npm run import:candidates', { stdio: 'ignore' })).toThrow();
    fs.renameSync(backupBrPath, brPath);
  });

  it('deve falhar se SC.csv estiver ausente', () => {
    fs.renameSync(scPath, backupScPath);
    expect(() => execSync('npm run import:candidates', { stdio: 'ignore' })).toThrow();
    fs.renameSync(backupScPath, scPath);
  });

  it('deve falhar com header inválido/ausente', () => {
    fs.renameSync(brPath, backupBrPath);
    fs.writeFileSync(brPath, '"COL1";"COL2"\n"VAL1";"VAL2"\n', 'utf8');
    expect(() => execSync('npm run import:candidates', { stdio: 'ignore' })).toThrow();
    fs.unlinkSync(brPath);
    fs.renameSync(backupBrPath, brPath);
  });

  it('deve falhar com ANO_ELEICAO inválido', () => {
    fs.renameSync(brPath, backupBrPath);
    const validHeader = '"ANO_ELEICAO";"NR_TURNO";"CD_ELEICAO";"SG_UF";"CD_CARGO";"DS_CARGO";"SQ_CANDIDATO";"NR_CANDIDATO";"NM_URNA_CANDIDATO";"NR_PARTIDO";"SG_PARTIDO";"NM_PARTIDO"\n';
    const badRow = '"INVALIDO";"1";"6257";"BR";"1";"PRESIDENTE";"280000000000";"99";"TESTE";"99";"TEST";"TEST"\n';
    fs.writeFileSync(brPath, validHeader + badRow, 'utf8');
    expect(() => execSync('npm run import:candidates', { stdio: 'ignore' })).toThrow();
    fs.unlinkSync(brPath);
    fs.renameSync(backupBrPath, brPath);
  });

  it('deve falhar com NR_TURNO inválido', () => {
    fs.renameSync(brPath, backupBrPath);
    const validHeader = '"ANO_ELEICAO";"NR_TURNO";"CD_ELEICAO";"SG_UF";"CD_CARGO";"DS_CARGO";"SQ_CANDIDATO";"NR_CANDIDATO";"NM_URNA_CANDIDATO";"NR_PARTIDO";"SG_PARTIDO";"NM_PARTIDO"\n';
    const badRow = '"2026";"INVALIDO";"6257";"BR";"1";"PRESIDENTE";"280000000000";"99";"TESTE";"99";"TEST";"TEST"\n';
    fs.writeFileSync(brPath, validHeader + badRow, 'utf8');
    expect(() => execSync('npm run import:candidates', { stdio: 'ignore' })).toThrow();
    fs.unlinkSync(brPath);
    fs.renameSync(backupBrPath, brPath);
  });
});

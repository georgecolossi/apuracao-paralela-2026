/**
 * APURAÇÃO PARALELA 2.0 — SUÍTE DE TESTES DO ADAPTADOR UNIVERSAL DE QRBU (PR 4)
 * 
 * Validação rigorosa dos adaptadores por formato (VRQR 6.0, 5.0, 4.0),
 * despacho determinístico sem inferências silenciosas, integridade de SHA-512,
 * separação estrita de assinatura digital, totalizadores e isolamento eleitoral no scanner.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { UniversalQrBuParser } from '@/lib/parser/adapter/UniversalQrBuParser';
import { Vrqr4Adapter } from '@/lib/parser/adapter/Vrqr4Adapter';
import { Vrqr5Adapter } from '@/lib/parser/adapter/Vrqr5Adapter';
import { Vrqr6Adapter } from '@/lib/parser/adapter/Vrqr6Adapter';
import { POST as scanRoute } from '@/app/api/scan/route';
import { prisma } from '@/lib/db';
import { generateCsrfToken } from '@/lib/security/csrf';
import * as auth from '@/lib/auth';

describe('PR 4 — Adaptador Universal de QRBU (VRQR 4.0, 5.0, 6.0)', () => {
  const parser = new UniversalQrBuParser();
  const examplesDir = path.join(__dirname, 'fixtures', 'tse-2026', 'official', 'examples');

  let adminUser: any;
  let operatorUser: any;
  let adminCsrfToken: string;
  let operatorCsrfToken: string;
  let activeTestSessionToken: string;

  function createAuthHeaders(csrfToken: string, host = 'localhost:3000', origin = 'http://localhost:3000') {
    return {
      'Content-Type': 'application/json',
      'Host': host,
      'Origin': origin,
      'X-CSRF-Token': csrfToken,
      'Cookie': `token=${activeTestSessionToken}`
    };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long-jwt-2026';
    process.env.CSRF_SECRET = 'test-csrf-secret-at-least-32-chars-long';
    process.env.ALLOW_SIMULATED_FASE = 'true';

    // Limpa tabelas de teste
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.party.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.election.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();

    adminUser = await prisma.user.create({
      data: {
        name: 'Admin Auditoria',
        email: 'admin.pr4@apuracao.local',
        passwordHash: '$2b$10$hashedpasswordfore2einitialadmin001',
        role: 'ADMIN',
        isActive: true,
        sessionVersion: 1
      }
    });

    operatorUser = await prisma.user.create({
      data: {
        name: 'Operador Scanner PR4',
        email: 'operator.pr4@apuracao.local',
        passwordHash: '$2b$10$hashedpasswordfore2eoperator00000001',
        role: 'OPERATOR',
        isActive: true,
        sessionVersion: 1
      }
    });

    operatorCsrfToken = generateCsrfToken(operatorUser.id, operatorUser.sessionVersion);
    adminCsrfToken = generateCsrfToken(adminUser.id, adminUser.sessionVersion);

    activeTestSessionToken = jwt.sign(
      {
        userId: operatorUser.id,
        email: operatorUser.email,
        role: operatorUser.role,
        sessionVersion: operatorUser.sessionVersion
      },
      process.env.JWT_SECRET!
    );

    vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
      authenticated: true,
      user: { userId: operatorUser.id, role: 'OPERATOR' }
    }));
  });

  describe('1. Identificação de Versões e Despacho Sem Inferências Silenciosas', () => {
    it('1.1 Deve identificar e despachar formato VRQR 6.0', () => {
      const header = 'QRBU:1:1 VRQR:6.0 ORIG:VOTA MUNI:1392 ZONA:9 SECA:13 IDUE:2250280';
      const adapter = parser.resolveAdapter(header);
      expect('code' in adapter).toBe(false);
      if (!('code' in adapter)) {
        expect(adapter.version).toBe('VRQR:6.0');
      }
    });

    it('1.2 Deve identificar e despachar formato VRQR 5.0 em ambiente de teste', () => {
      const header = 'QRBU:1:1 VRQR:5.0 ORIG:VOTA MUNI:80837 ZONA:90 SECA:1 IDUE:123456';
      const adapter = parser.resolveAdapter(header, { allowExperimental: true });
      expect('code' in adapter).toBe(false);
      if (!('code' in adapter)) {
        expect(adapter.version).toBe('VRQR:5.0');
      }
    });

    it('1.3 Deve identificar e despachar formato VRQR 4.0 em ambiente de teste', () => {
      const header = 'QRBU:1:1 VRQR:4.0 ORIG:VOTA MUNI:80837 ZONA:90 SECA:1 IDUE:654321';
      const adapter = parser.resolveAdapter(header, { allowExperimental: true });
      expect('code' in adapter).toBe(false);
      if (!('code' in adapter)) {
        expect(adapter.version).toBe('VRQR:4.0');
      }
    });

    it('1.4 Deve rejeitar determinística e explicitamente versão VRQR não homologada (ex: VRQR:3.0)', () => {
      const header = 'QRBU:1:1 VRQR:3.0 ORIG:VOTA MUNI:1392 ZONA:9 SECA:13 IDUE:2250280';
      const result = parser.resolveAdapter(header);
      expect('code' in result).toBe(true);
      if ('code' in result) {
        expect(result.code).toBe('UNSUPPORTED_VRQR_VERSION');
        expect(result.message).toContain('VRQR:3.0');
      }
    });

    it('1.5 Deve rejeitar cabeçalho ausente ou malformado sem VRQR', () => {
      const invalidHeader = 'QRBU:1:1 SEM_VRQR ORIG:VOTA MUNI:1392';
      const result = parser.resolveAdapter(invalidHeader);
      expect('code' in result).toBe(true);
      if ('code' in result) {
        expect(result.code).toBe('INVALID_HEADER');
      }
    });

    it('1.6 Deve listar formatos homologados e pendentes com transparência e honestidade', () => {
      const supported = parser.getSupportedVersions();
      expect(supported).toContain('VRQR:6.0');
      // VRQR 4.0 e 5.0 não devem constar como homologados por padrão
      expect(supported).not.toContain('VRQR:4.0');
      expect(supported).not.toContain('VRQR:5.0');

      const experimental = parser.getExperimentalVersions();
      expect(experimental.some(e => e.version === 'VRQR:5.0')).toBe(true);
      expect(experimental.some(e => e.version === 'VRQR:4.0')).toBe(true);

      const pending = parser.getPendingVersions();
      expect(pending.some(p => p.version === 'VRQR:3.0' && p.status === 'PENDENTE')).toBe(true);
      expect(pending.some(p => p.version === 'FORMATO_ASN1_BINARIO')).toBe(true);
    });
  });

  describe('2. Reconstrução Multipartes e Validações Negativas Estritas', () => {
    it('2.1 Deve reconstruir multipartes entregues fora de ordem cronológica', () => {
      const part2 = 'QRBU:2:2 VRQR:6.0 92:1 93:2 BRAN:0 NULO:0 HASH:ABC';
      const part1 = 'QRBU:1:2 VRQR:6.0 ORIG:VOTA PLEI:2200 MUNI:80837 ZONA:90 SECA:1 IDUE:123';

      const reconstructed = parser.reconstruct([part2, part1]);
      expect(typeof reconstructed).toBe('string');
      // A parte 1 deve vir primeiro na concatenação final
      expect((reconstructed as string).startsWith('VRQR:6.0 ORIG:VOTA PLEI:2200')).toBe(true);
      expect((reconstructed as string).endsWith('HASH:ABC')).toBe(true);
    });

    it('2.2 Deve rejeitar reconstrução com partes de índices duplicados (DUPLICATE_PARTS)', () => {
      const part1a = 'QRBU:1:2 VRQR:6.0 ORIG:VOTA PLEI:2200 MUNI:80837 ZONA:90 SECA:1 IDUE:123';
      const part1b = 'QRBU:1:2 VRQR:6.0 OUTRO_CONTEUDO PLEI:2200 MUNI:80837 ZONA:90 SECA:1 IDUE:123';

      const result = parser.reconstruct([part1a, part1b]);
      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.code).toBe('DUPLICATE_PARTS');
      }
    });

    it('2.3 Deve rejeitar reconstrução quando faltarem partes (MISSING_PARTS)', () => {
      const part1 = 'QRBU:1:3 VRQR:6.0 ORIG:VOTA PLEI:2200 MUNI:80837 ZONA:90 SECA:1 IDUE:123';
      const part2 = 'QRBU:2:3 VRQR:6.0 CARG:1 92:1';

      const result = parser.reconstruct([part1, part2]);
      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.code).toBe('MISSING_PARTS');
      }
    });

    it('2.4 Deve rejeitar partes informando versões VRQR divergentes (TOTAL_MISMATCH)', () => {
      const part1 = 'QRBU:1:2 VRQR:6.0 ORIG:VOTA PLEI:2200 MUNI:80837 ZONA:90 SECA:1 IDUE:123';
      const part2 = 'QRBU:2:2 VRQR:5.0 CARG:1 92:1 HASH:ABC';

      const result = parser.reconstruct([part1, part2]);
      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.code).toBe('TOTAL_MISMATCH');
      }
    });
  });

  describe('3. Integridade Criptográfica de Hash SHA-512 e Assinatura Digital', () => {
    it('3.1 Deve rejeitar hash SHA-512 adulterado (INVALID_HASH)', () => {
      const part1 = 'QRBU:1:1 VRQR:6.0 ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1 HASH:DEADBEEF000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
      const full = parser.reconstruct([part1]) as string;
      const parsed = parser.parseReport(full, [part1]);

      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_HASH');
      }
    });

    it('3.2 Separação Criptográfica: nunca declarar assinatura como VERIFIED sem chaves públicas (sigStatus = UNAVAILABLE)', () => {
      const body = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1';
      const computedHash = crypto.createHash('sha512').update(body, 'utf8').digest('hex').toUpperCase();
      const rawPart = `QRBU:1:1 VRQR:6.0 ${body} HASH:${computedHash} ASSI:F509E65CE37604D01B5EBE88`;

      const parsed = parser.parseReport(`${body} HASH:${computedHash} ASSI:F509E65CE37604D01B5EBE88`, [rawPart]);
      expect('code' in parsed).toBe(false);
      if (!('code' in parsed)) {
        expect(parsed.hashStatus).toBe('VERIFIED');
        expect(parsed.sigStatus).toBe('UNAVAILABLE');
        expect(parsed.sigValidationNote).toContain('chaves públicas oficiais');
      }
    });

    it('3.3 Deve marcar hashStatus como UNAVAILABLE quando campo HASH está ausente no payload', () => {
      const partSemHash = 'QRBU:1:1 VRQR:6.0 ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1';
      const parsed = parser.parseReport(partSemHash, [partSemHash]);

      expect('code' in parsed).toBe(false);
      if (!('code' in parsed)) {
        expect(parsed.hashStatus).toBe('UNAVAILABLE');
      }
    });

    it('3.4 Deve rejeitar QRBU com hash truncado (< 128 caracteres) (INVALID_HASH)', () => {
      // 120 caracteres em vez de 128
      const hashTruncado = 'A'.repeat(120);
      const rawPart = `QRBU:1:1 VRQR:6.0 ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1 HASH:${hashTruncado}`;
      const parsed = parser.parseReport(rawPart, [rawPart]);

      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_HASH');
      }
    });

    it('3.5 Deve rejeitar QRBU com caracteres não-hexadecimais no hash (INVALID_HASH)', () => {
      // 128 caracteres contendo caracteres inválidos 'Z'
      const hashInvalido = 'ZZZZ' + 'A'.repeat(124);
      const rawPart = `QRBU:1:1 VRQR:6.0 ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1 HASH:${hashInvalido}`;
      const parsed = parser.parseReport(rawPart, [rawPart]);

      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_HASH');
      }
    });

    it('3.6 Deve rejeitar verificação quando partes brutas originais não forem fornecidas (INVALID_HASH)', () => {
      const validHash = 'A'.repeat(128);
      const payload = `VRQR:6.0 ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1 HASH:${validHash}`;
      const parsed = parser.parseReport(payload, []);

      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_HASH');
      }
    });
  });

  describe('4. Bateria de Verificação Completa nas 10 Fixtures Oficiais do TSE em Disco', () => {
    let examples: string[] = [];

    beforeAll(() => {
      if (fs.existsSync(examplesDir)) {
        examples = fs.readdirSync(examplesDir).filter(dir =>
          fs.statSync(path.join(examplesDir, dir)).isDirectory()
        );
      }
    });

    it('4.1 Deve processar e validar com sucesso 100% das fixtures oficiais do TSE (10 de 10)', () => {
      expect(examples.length).toBe(10);

      for (const example of examples) {
        const decodedDir = path.join(examplesDir, example, 'decoded');
        const files = fs.readdirSync(decodedDir)
          .filter(f => /^qrbu-\d+-of-\d+\.txt$/.test(f))
          .sort();

        const rawParts = files.map(file => fs.readFileSync(path.join(decodedDir, file), 'utf8').trim());
        expect(rawParts.length).toBeGreaterThan(0);

        // 1. Reconstrução
        const fullPayload = parser.reconstruct(rawParts);
        expect(typeof fullPayload).toBe('string');

        // 2. Parsing e Validação Criptográfica
        const report = parser.parseReport(fullPayload as string, rawParts);
        expect('code' in report).toBe(false);

        if (!('code' in report)) {
          // Hash SHA-512 verificado em 100% das fixtures
          expect(report.hashStatus).toBe('VERIFIED');
          // Assinatura digital explicitamente não verificada (ausência de chaves da urna)
          expect(report.sigStatus).toBe('UNAVAILABLE');

          // Metadados essenciais de identificação
          expect(report.cityCode).toBeDefined();
          expect(report.zoneCode).toBeDefined();
          expect(report.sectionCode).toBeDefined();
          expect(report.urnCode).toBeDefined();
          expect(report.vrqrVersion).toBe('6.0');

          // Votos decodificados
          expect(report.votes.length).toBeGreaterThan(0);
        }
      }
    });

    it('4.2 Validação Semântica de Cargos Proporcionais e Votos de Legenda (Fixture UE2015)', () => {
      const ue2015Dir = path.join(examplesDir, 'UE2015_s02110ac0139200090110-imgbu', 'decoded');
      const files = ['qrbu-01-of-02.txt', 'qrbu-02-of-02.txt'];
      const rawParts = files.map(f => fs.readFileSync(path.join(ue2015Dir, f), 'utf8').trim());

      const full = parser.reconstruct(rawParts) as string;
      const report = parser.parseReport(full, rawParts);

      expect('code' in report).toBe(false);
      if (!('code' in report)) {
        // Deputado Federal (CARG 6 - Proporcional)
        const depFedVotes = report.votes.filter(v => v.officeCode === '6');
        expect(depFedVotes.length).toBeGreaterThan(0);

        // Verifica votos de legenda (LEGP) capturados
        const legendaVotes = depFedVotes.filter(v => v.type === 'LEGENDA');
        expect(legendaVotes.length).toBeGreaterThan(0);
        expect(legendaVotes[0].partyNumber).toBe('92');
        expect(legendaVotes[0].quantity).toBe(1);

        // Verifica votos nominais em candidatos
        const nominalVotes = depFedVotes.filter(v => v.type === 'NOMINAL');
        expect(nominalVotes.length).toBeGreaterThan(0);
        expect(nominalVotes.some(v => v.candidateNumber === '9301')).toBe(true);

        // Senador (CARG 5 - Majoritário com 2 vagas)
        const senadorVotes = report.votes.filter(v => v.officeCode === '5');
        expect(senadorVotes.length).toBeGreaterThan(0);
        const totalSenadorVotes = senadorVotes.reduce((acc, v) => acc + v.quantity, 0);
        expect(totalSenadorVotes).toBe(8);
      }
    });

    it('4.3 Validação Semântica de Consulta Popular / Plebiscito (Fixture PresGovConMunic)', () => {
      const conDir = path.join(examplesDir, 'PresGovConMunic-T2_s02120ac0139200090013-imgbu', 'decoded');
      const rawPart = fs.readFileSync(path.join(conDir, 'qrbu-01-of-01.txt'), 'utf8').trim();

      const report = parser.parseReport(rawPart, [rawPart]);
      expect('code' in report).toBe(false);
      if (!('code' in report)) {
        // Consulta Popular (CARG 53)
        const consultaVotes = report.votes.filter(v => v.officeCode === '53');
        expect(consultaVotes.length).toBeGreaterThan(0);
        expect(consultaVotes.some(v => v.candidateNumber === '5' && v.quantity === 2)).toBe(true);
      }
    });
  });

  describe('5. Validação Semântica Fail-Closed e Consistência de Totalizadores', () => {
    function createSignedPart(body: string): string {
      const hash = crypto.createHash('sha512').update(body, 'utf8').digest('hex').toUpperCase();
      return `QRBU:1:1 VRQR:6.0 ${body} HASH:${hash}`;
    }

    it('5.1 Rejeita BU quando PLEI está ausente (MISSING_FIELDS)', () => {
      const body = 'ORIG:VOTA TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1';
      const part = createSignedPart(body);
      const parsed = parser.parseReport(part, [part]);
      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('MISSING_FIELDS');
        expect(parsed.message).toContain('PLEI');
      }
    });

    it('5.2 Rejeita BU quando TURN é ausente ou inválido (INVALID_ROUND_NUMBER)', () => {
      const body = 'ORIG:VOTA PLEI:2200 TURN:0 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1';
      const part = createSignedPart(body);
      const parsed = parser.parseReport(part, [part]);
      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_ROUND_NUMBER');
      }
    });

    it('5.3 Rejeita BU quando UNFE é ausente ou inválida (INVALID_UF_CODE)', () => {
      const body = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:XYZ MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1';
      const part = createSignedPart(body);
      const parsed = parser.parseReport(part, [part]);
      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_UF_CODE');
      }
    });

    it('5.4 Rejeita voto sem cargo definido antes (INVALID_OFFICE_CODE)', () => {
      const body = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 92:1 BRAN:0 NULO:0 TOTC:1';
      const part = createSignedPart(body);
      const parsed = parser.parseReport(part, [part]);
      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_OFFICE_CODE');
      }
    });

    it('5.5 Rejeita divergência entre a soma dos votos e o totalizador oficial (VOTE_TOTAL_MISMATCH)', () => {
      // Candidato 92 tem 2 votos, BRANCO tem 1 -> soma = 3, mas TOTC informa 4
      const body = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:2 BRAN:1 NULO:0 TOTC:4';
      const computedHash = crypto.createHash('sha512').update(body, 'utf8').digest('hex').toUpperCase();
      const rawPart = `QRBU:1:1 VRQR:6.0 ${body} HASH:${computedHash}`;

      const parsed = parser.parseReport(rawPart, [rawPart]);
      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('VOTE_TOTAL_MISMATCH');
        expect(parsed.message).toContain('diverge do totalizador oficial');
      }
    });

    it('5.6 Rejeita quantidade de votos não numérica ou fracionária (INVALID_VOTE_DATA)', () => {
      const body = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:12.5 BRAN:0 NULO:0 TOTC:12';
      const part = createSignedPart(body);
      const parsed = parser.parseReport(part, [part]);
      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_VOTE_DATA');
      }
    });
  });

  describe('6. Regras Particulares de Adaptadores por Layout Histórico', () => {
    it('6.1 Vrqr4Adapter rejeita cargo de Presidente (INVALID_OFFICE_FOR_LAYOUT)', () => {
      const vrqr4 = new Vrqr4Adapter();
      const bodyPres = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 TOTC:1';
      const hash = crypto.createHash('sha512').update(bodyPres, 'utf8').digest('hex').toUpperCase();
      const raw = `QRBU:1:1 VRQR:4.0 ${bodyPres} HASH:${hash}`;

      const res = vrqr4.parseReport(raw, [raw]);
      expect('code' in res).toBe(true);
      if ('code' in res) {
        expect(res.code).toBe('INVALID_OFFICE_FOR_LAYOUT');
        expect(res.message).toContain('Presidente');
      }
    });

    it('6.2 Vrqr4Adapter aceita cargo municipal de Prefeito (CARG:11)', () => {
      const vrqr4 = new Vrqr4Adapter();
      const bodyPref = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:11 15:10 BRAN:1 NULO:1 TOTC:12';
      const hash = crypto.createHash('sha512').update(bodyPref, 'utf8').digest('hex').toUpperCase();
      const raw = `QRBU:1:1 VRQR:4.0 ${bodyPref} HASH:${hash}`;

      const res = vrqr4.parseReport(raw, [raw]);
      expect('code' in res).toBe(false);
      if (!('code' in res)) {
        expect(res.votes[0].officeName).toBe('Prefeito');
        expect(res.hashStatus).toBe('VERIFIED');
      }
    });

    it('6.3 Vrqr5Adapter rejeita cargo municipal de Prefeito (INVALID_OFFICE_FOR_LAYOUT)', () => {
      const vrqr5 = new Vrqr5Adapter();
      const bodyPref = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:11 15:10 BRAN:1 NULO:1 TOTC:12';
      const hash = crypto.createHash('sha512').update(bodyPref, 'utf8').digest('hex').toUpperCase();
      const raw = `QRBU:1:1 VRQR:5.0 ${bodyPref} HASH:${hash}`;

      const res = vrqr5.parseReport(raw, [raw]);
      expect('code' in res).toBe(true);
      if ('code' in res) {
        expect(res.code).toBe('INVALID_OFFICE_FOR_LAYOUT');
        expect(res.message).toContain('Prefeito');
      }
    });

    it('6.4 Vrqr5Adapter aceita cargo de Presidente e Senador', () => {
      const vrqr5 = new Vrqr5Adapter();
      const bodyGeral = 'ORIG:VOTA PLEI:2200 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 13:5 TOTC:5 CARG:5 221:5 TOTC:5';
      const hash = crypto.createHash('sha512').update(bodyGeral, 'utf8').digest('hex').toUpperCase();
      const raw = `QRBU:1:1 VRQR:5.0 ${bodyGeral} HASH:${hash}`;

      const res = vrqr5.parseReport(raw, [raw]);
      expect('code' in res).toBe(false);
      if (!('code' in res)) {
        expect(res.votes.length).toBe(2);
        expect(res.hashStatus).toBe('VERIFIED');
      }
    });
  });

  describe('7. Isolamento Eleitoral e Catálogo de Cargos no Scanner (/api/scan)', () => {
    it('7.1 Rejeita com OFFICE_NOT_CONFIGURED quando BU contém cargo não cadastrado na eleição ativa', async () => {
      // Cria eleição com apenas o cargo "Presidente" (código 1)
      const stateAC = await prisma.state.upsert({
        where: { abbreviation: 'AC' },
        update: {},
        create: { name: 'Acre', abbreviation: 'AC' }
      });
      const muni = await prisma.municipality.upsert({
        where: { officialCode: '01392' },
        update: {},
        create: { officialCode: '01392', name: 'Acrelândia', stateId: stateAC.id }
      });
      const zone = await prisma.pollingZone.upsert({
        where: { municipalityId_zoneNumber: { municipalityId: muni.id, zoneNumber: '0009' } },
        update: {},
        create: { zoneNumber: '0009', municipalityId: muni.id }
      });
      const section = await prisma.pollingSection.upsert({
        where: { pollingZoneId_sectionNumber: { pollingZoneId: zone.id, sectionNumber: '0013' } },
        update: {},
        create: { sectionNumber: '0013', pollingZoneId: zone.id, expectedBUs: 1 }
      });

      // Desativa eleições anteriores
      await prisma.electionRound.updateMany({ data: { status: 'FINISHED' } });

      const elecSemPref = await prisma.election.create({
        data: {
          name: 'Eleição Presidencial Estrita',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 2,
              status: 'ACTIVE',
              plei: '3333',
              coverageStatus: 'PROVISIONAL'
            }
          },
          scopes: { create: { scopeKey: 'ESTADUAL:AC', scopeType: 'ESTADUAL' } },
          // Apenas cargo Presidente cadastrado!
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      // Cria BU contendo votos para o cargo 11 (Prefeito)
      const bodyWithPrefeito = 'ORIG:VOTA PLEI:3333 TURN:2 FASE:O UNFE:AC MUNI:01392 ZONA:9 SECA:13 IDUE:123 CARG:11 15:5 BRAN:0 NULO:0 TOTC:5';
      const hash = crypto.createHash('sha512').update(bodyWithPrefeito, 'utf8').digest('hex').toUpperCase();
      const raw = `QRBU:1:1 VRQR:6.0 ${bodyWithPrefeito} HASH:${hash}`;

      const res = await scanRoute(new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-office-not-configured-001',
          content: raw,
          isSimulation: false
        })
      }));

      // Não pode criar o cargo 11 automaticamente, deve rejeitar com erro controlado!
      expect([400, 422]).toContain(res.status);
      const data = await res.json();
      expect(data.error).toBe('OFFICE_NOT_CONFIGURED');

      // Confirma no banco que nenhum cargo "Prefeito" foi criado indevidamente
      const createdOffices = await prisma.office.findMany({
        where: { electionId: elecSemPref.id }
      });
      expect(createdOffices.length).toBe(1);
      expect(createdOffices[0].name).toBe('Presidente');
    });

    it('7.2 Cobertura Estrita (REGISTERED/HOMOLOGATED): rejeita seção fora do RoundCoverage', async () => {
      await prisma.electionRound.updateMany({ data: { status: 'FINISHED' } });

      const stateAC = await prisma.state.findUniqueOrThrow({ where: { abbreviation: 'AC' } });
      const muni = await prisma.municipality.findUniqueOrThrow({ where: { officialCode: '01392' } });
      const zone = await prisma.pollingZone.findFirstOrThrow({ where: { municipalityId: muni.id } });
      const section = await prisma.pollingSection.findFirstOrThrow({ where: { pollingZoneId: zone.id } });

      // Cria eleição com cobertura REGISTERED contendo apenas a seção 0013
      const elecStrict = await prisma.election.create({
        data: {
          name: 'Eleição Cobertura Registrada',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 2,
              status: 'ACTIVE',
              plei: '4444',
              coverageStatus: 'REGISTERED',
              coverage: { create: { pollingSectionId: section.id, expectedBUs: 1 } }
            }
          },
          scopes: { create: { scopeKey: 'ESTADUAL:AC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      // Tenta enviar BU da seção 9999 (não contemplada na cobertura registrada)
      const bodySecInexistente = 'ORIG:VOTA PLEI:4444 TURN:2 FASE:O UNFE:AC MUNI:01392 ZONA:9 SECA:9999 IDUE:123 CARG:1 13:5 TOTC:5';
      const hash = crypto.createHash('sha512').update(bodySecInexistente, 'utf8').digest('hex').toUpperCase();
      const raw = `QRBU:1:1 VRQR:6.0 ${bodySecInexistente} HASH:${hash}`;

      const res = await scanRoute(new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-strict-cov-001',
          content: raw,
          isSimulation: false
        })
      }));

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('OUT_OF_COVERAGE');
    });

    it('7.3 Ingestão oficial com sucesso de fixture oficial TSE em contexto compatível', async () => {
      await prisma.electionRound.updateMany({ data: { status: 'FINISHED' } });

      const stateAC = await prisma.state.findUniqueOrThrow({ where: { abbreviation: 'AC' } });
      const muni = await prisma.municipality.findUniqueOrThrow({ where: { officialCode: '01392' } });
      const zone = await prisma.pollingZone.findFirstOrThrow({ where: { municipalityId: muni.id } });
      const section = await prisma.pollingSection.findFirstOrThrow({ where: { pollingZoneId: zone.id } });

      const elec = await prisma.election.create({
        data: {
          name: 'Eleição Oficial TSE 2026 T2',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 2,
              status: 'ACTIVE',
              plei: '2202',
              coverageStatus: 'PROVISIONAL'
            }
          },
          scopes: { create: { scopeKey: 'ESTADUAL:AC', scopeType: 'ESTADUAL' } },
          offices: {
            create: {
              code: '1',
              name: 'Presidente',
              candidates: {
                create: {
                  candidateNumber: '92',
                  name: 'Candidato 92',
                  ballotName: 'Candidato 92',
                  party: {
                    create: {
                      officialIdentifier: '92',
                      name: 'Partido 92',
                      abbreviation: 'P92'
                    }
                  }
                }
              }
            }
          }
        }
      });

      const presDir = path.join(examplesDir, 'Pres-T2_s02202ac0139200090013-imgbu', 'decoded');
      const rawContent = fs.readFileSync(path.join(presDir, 'qrbu-01-of-01.txt'), 'utf8').trim();

      const res = await scanRoute(new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-fixture-pres-001',
          content: rawContent,
          isSimulation: false
        })
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('COMPLETO');
      expect(data.reportId).toBeDefined();

      const saved = await prisma.ballotReport.findUnique({
        where: { id: data.reportId },
        include: { votes: true }
      });
      expect(saved?.vrqrVersion).toBe('6.0');
      const val = JSON.parse(saved?.validationData || '{}');
      expect(val.hashStatus).toBe('VERIFIED');
      expect(val.sigStatus).toBe('UNAVAILABLE');
    });

    it('7.4 Rejeita com CRYPTOGRAPHIC_INTEGRITY_FAILED quando hashStatus é UNAVAILABLE ou divergente em ingestão oficial', async () => {
      // Cria BU com FASE:O sem campo HASH
      const rawNoHash = 'QRBU:1:1 VRQR:6.0 ORIG:VOTA PLEI:2202 TURN:2 FASE:O UNFE:AC MUNI:01392 ZONA:9 SECA:13 IDUE:123 CARG:1 13:5 TOTC:5';

      const res = await scanRoute(new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-nohash-001',
          content: rawNoHash,
          isSimulation: false
        })
      }));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CRYPTOGRAPHIC_INTEGRITY_FAILED');
    });
  });
});

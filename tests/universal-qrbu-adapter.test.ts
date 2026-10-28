import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { POST as scanRoute } from '@/app/api/scan/route';
import { generateCsrfToken } from '@/lib/security/csrf';
import {
  UniversalQrBuParser,
  Vrqr6Adapter,
  Vrqr5Adapter,
  Vrqr4Adapter,
  QrBuAdapter
} from '@/lib/parser';

let activeTestSessionToken: string | undefined = undefined;

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === 'admin_session' && activeTestSessionToken) {
        return { name: 'admin_session', value: activeTestSessionToken };
      }
      return undefined;
    },
    set: vi.fn((name: string, value: string) => {
      if (name === 'admin_session') {
        activeTestSessionToken = value;
      }
    }),
    delete: vi.fn(() => {
      activeTestSessionToken = undefined;
    })
  }))
}));

describe('PR 4 — Adaptador Universal de QRBU (VRQR 4.0, 5.0, 6.0)', () => {
  const parser = new UniversalQrBuParser();
  const examplesDir = path.join(__dirname, 'fixtures', 'tse-2026', 'official', 'examples');

  let operatorUser: any;
  let adminUser: any;
  let operatorCsrfToken: string;
  let adminCsrfToken: string;

  const createAuthHeaders = (csrf?: string) => ({
    'Content-Type': 'application/json',
    'Host': 'localhost:3000',
    'Origin': 'http://localhost:3000',
    ...(csrf ? { 'X-CSRF-Token': csrf } : {})
  });

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-key-for-pr4-qrbu-adapter-32chars!';
    process.env.ALLOW_SIMULATED_FASE = 'true';
    expect(process.env.DATABASE_URL).toContain('test.db');
  });

  beforeEach(async () => {
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

    const passHash = await bcrypt.hash('SenhaSegura123!', 10);

    operatorUser = await prisma.user.create({
      data: {
        name: 'Operador Scanner',
        email: 'operador.pr4@teste.gov.br',
        passwordHash: passHash,
        role: 'OPERATOR',
        isActive: true,
        sessionVersion: 1
      }
    });

    adminUser = await prisma.user.create({
      data: {
        name: 'Administrador PR4',
        email: 'admin.pr4@teste.gov.br',
        passwordHash: passHash,
        role: 'ADMIN',
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

    it('1.2 Deve identificar e despachar formato VRQR 5.0 (Eleições Gerais 2022)', () => {
      const header = 'QRBU:1:1 VRQR:5.0 ORIG:VOTA MUNI:80837 ZONA:90 SECA:1 IDUE:123456';
      const adapter = parser.resolveAdapter(header);
      expect('code' in adapter).toBe(false);
      if (!('code' in adapter)) {
        expect(adapter.version).toBe('VRQR:5.0');
      }
    });

    it('1.3 Deve identificar e despachar formato VRQR 4.0 (Eleições Municipais 2020)', () => {
      const header = 'QRBU:1:1 VRQR:4.0 ORIG:VOTA MUNI:80837 ZONA:90 SECA:1 IDUE:654321';
      const adapter = parser.resolveAdapter(header);
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

    it('1.6 Deve documentar expressamente as versões suportadas e pendentes', () => {
      const supported = parser.getSupportedVersions();
      expect(supported).toContain('VRQR:6.0');
      expect(supported).toContain('VRQR:5.0');
      expect(supported).toContain('VRQR:4.0');

      const pending = parser.getPendingVersions();
      expect(pending.some(p => p.version === 'VRQR:3.0' && p.status === 'PENDENTE')).toBe(true);
      expect(pending.some(p => p.version === 'FORMATO_ASN1_BINARIO' && p.status === 'PENDENTE')).toBe(true);
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

    it('2.3 Deve rejeitar reconstrução com partes faltantes (MISSING_PARTS)', () => {
      const part1 = 'QRBU:1:3 VRQR:6.0 ORIG:VOTA PLEI:2200';
      const part2 = 'QRBU:2:3 VRQR:6.0 MUNI:80837 ZONA:90';
      // Parte 3 de 3 ausente

      const result = parser.reconstruct([part1, part2]);
      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.code).toBe('MISSING_PARTS');
      }
    });

    it('2.4 Deve rejeitar partes que informam total de partes divergente (TOTAL_MISMATCH)', () => {
      const part1 = 'QRBU:1:2 VRQR:6.0 ORIG:VOTA PLEI:2200';
      const part2 = 'QRBU:2:3 VRQR:6.0 MUNI:80837 ZONA:90'; // Informa total 3 enquanto parte 1 informa 2

      const result = parser.reconstruct([part1, part2]);
      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.code).toBe('TOTAL_MISMATCH');
      }
    });

    it('2.5 Deve rejeitar partes com versões divergentes (TOTAL_MISMATCH)', () => {
      const part1 = 'QRBU:1:2 VRQR:6.0 ORIG:VOTA PLEI:2200';
      const part2 = 'QRBU:2:2 VRQR:5.0 MUNI:80837 ZONA:90'; // Mistura VRQR 6.0 com 5.0

      const result = parser.reconstruct([part1, part2]);
      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.code).toBe('TOTAL_MISMATCH');
      }
    });
  });

  describe('3. Validação Criptográfica de Hash SHA-512 e Assinatura Digital', () => {
    it('3.1 Deve rejeitar hash SHA-512 adulterado (INVALID_HASH)', () => {
      // Mock de payload simples com hash incorreto
      const part1 = 'QRBU:1:1 VRQR:6.0 ORIG:VOTA MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0 HASH:DEADBEEF000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
      const full = parser.reconstruct([part1]) as string;
      const parsed = parser.parseReport(full, [part1]);

      expect('code' in parsed).toBe(true);
      if ('code' in parsed) {
        expect(parsed.code).toBe('INVALID_HASH');
      }
    });

    it('3.2 Separação Criptográfica: nunca declarar assinatura como VERIFIED sem chaves públicas (sigStatus = UNAVAILABLE)', () => {
      // Cria um BU válido calculando o hash real
      const body = 'ORIG:VOTA MUNI:80837 ZONA:90 SECA:1 IDUE:123 CARG:1 92:1 BRAN:0 NULO:0';
      const computedHash = crypto.createHash('sha512').update(body, 'utf8').digest('hex').toUpperCase();
      const rawPart = `QRBU:1:1 VRQR:6.0 ${body} HASH:${computedHash} ASSI:F509E65CE37604D01B5EBE88`;

      const parsed = parser.parseReport(`${body} HASH:${computedHash} ASSI:F509E65CE37604D01B5EBE88`, [rawPart]);
      expect('code' in parsed).toBe(false);
      if (!('code' in parsed)) {
        // Hash de integridade DEVE ser VERIFIED
        expect(parsed.hashStatus).toBe('VERIFIED');
        // Assinatura digital DEVE ser estritamente UNAVAILABLE (sem chaves públicas off-band do TSE)
        expect(parsed.sigStatus).toBe('UNAVAILABLE');
        expect(parsed.sigValidationNote).toContain('chaves públicas oficiais');
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
        // Na fixture UE2015 há 8 votos para Senador computados (NOMI:6 + BRAN:1 + NULO:1 = 8)
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
        expect(consultaVotes.some(v => v.candidateNumber === '7' && v.quantity === 1)).toBe(true);
      }
    });

    it('4.4 Validação Semântica de Múltiplos Cargos com Prefeito (Fixture PresGovPrefeito)', () => {
      const prefDir = path.join(examplesDir, 'PresGovPrefeito-T2_s18153sp6665603020018-imgbu', 'decoded');
      const files = ['qrbu-01-of-01.txt'];
      const rawParts = files.map(f => fs.readFileSync(path.join(prefDir, f), 'utf8').trim());

      const full = parser.reconstruct(rawParts) as string;
      const report = parser.parseReport(full, rawParts);

      expect('code' in report).toBe(false);
      if (!('code' in report)) {
        // Prefeito (CARG 11)
        const prefeitoVotes = report.votes.filter(v => v.officeCode === '11');
        expect(prefeitoVotes.length).toBeGreaterThan(0);
        // Governador (CARG 3)
        const govVotes = report.votes.filter(v => v.officeCode === '3');
        expect(govVotes.length).toBeGreaterThan(0);
        // Presidente (CARG 1)
        const presVotes = report.votes.filter(v => v.officeCode === '1');
        expect(presVotes.length).toBeGreaterThan(0);
      }
    });
  });

  describe('5. Integração com a Rota Ingestora (/api/scan)', () => {
    it('5.1 Ingestão completa de BU oficial via /api/scan com armazenamento de vrqrVersion e integridade', async () => {
      // 1. Configurar Eleição e Turno ativos correspondentes à fixture Pres-T2
      // Fixture Pres-T2: PLEI:2202, TURN:2, UNFE:AC, MUNI:1392, ZONA:9, SECA:13, IDUE:2250280
      const stateAC = await prisma.state.create({ data: { name: 'Acre', abbreviation: 'AC' } });
      const muni = await prisma.municipality.create({
        data: {
          officialCode: '01392',
          name: 'Município Acre Teste',
          stateId: stateAC.id
        }
      });
      const zone = await prisma.pollingZone.create({
        data: {
          zoneNumber: '0009',
          municipalityId: muni.id
        }
      });
      const section = await prisma.pollingSection.create({
        data: {
          sectionNumber: '0013',
          pollingZoneId: zone.id,
          expectedBUs: 1
        }
      });

      const election = await prisma.election.create({
        data: {
          name: 'Eleição Geral Teste PR4',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 2,
              status: 'ACTIVE',
              plei: '2202',
              coverage: {
                create: {
                  pollingSectionId: section.id,
                  expectedBUs: 1
                }
              }
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
        },
        include: { rounds: true }
      });

      // 2. Ler conteúdo oficial da fixture Pres-T2 (1 parte)
      const presDir = path.join(examplesDir, 'Pres-T2_s02202ac0139200090013-imgbu', 'decoded');
      const rawContent = fs.readFileSync(path.join(presDir, 'qrbu-01-of-01.txt'), 'utf8').trim();

      const sessionId = 'session-pr4-integration-001';

      const req = new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId,
          content: rawContent,
          isSimulation: false
        })
      });

      const res = await scanRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('COMPLETO');
      expect(data.reportId).toBeDefined();

      // 3. Verificar que o BallotReport foi salvo com os campos do adaptador universal
      const savedReport = await prisma.ballotReport.findUnique({
        where: { id: data.reportId },
        include: { votes: true }
      });

      expect(savedReport).toBeDefined();
      expect(savedReport?.vrqrVersion).toBe('6.0');
      expect(savedReport?.cityCode).toBe('01392');
      expect(savedReport?.zoneCode).toBe('9');
      expect(savedReport?.sectionCode).toBe('13');

      // Validar dados criptográficos salvos
      const validationData = JSON.parse(savedReport?.validationData || '{}');
      expect(validationData.hashStatus).toBe('VERIFIED');
      expect(validationData.sigStatus).toBe('UNAVAILABLE');

      // Validar votos inseridos
      expect(savedReport?.votes.length).toBeGreaterThan(0);
      const candVote = savedReport?.votes.find(v => v.candidateNumber === '92');
      expect(candVote).toBeDefined();
      expect(candVote?.quantity).toBe(2);
    });

    it('5.2 Rejeição de BU pertencente a pleito diferente (ELECTION_CONTEXT_MISMATCH)', async () => {
      // Cria eleição com plei diferente (9999)
      await prisma.election.create({
        data: {
          name: 'Eleição Outro Pleito',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 2,
              status: 'ACTIVE',
              plei: '9999' // Pleito divergente da fixture (que é 2202)
            }
          }
        }
      });

      const presDir = path.join(examplesDir, 'Pres-T2_s02202ac0139200090013-imgbu', 'decoded');
      const rawContent = fs.readFileSync(path.join(presDir, 'qrbu-01-of-01.txt'), 'utf8').trim();

      const req = new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-mismatch-002',
          content: rawContent,
          isSimulation: false
        })
      });

      const res = await scanRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('ELECTION_CONTEXT_MISMATCH');
    });

    it('5.3 Idempotência: re-envio do mesmo BU deve retornar status 409 DUPLICADO', async () => {
      // Cria infraestrutura
      const stateAC = await prisma.state.create({ data: { name: 'Acre', abbreviation: 'AC' } });
      const muni = await prisma.municipality.create({
        data: { officialCode: '01392', name: 'Acre', stateId: stateAC.id }
      });
      const zone = await prisma.pollingZone.create({
        data: { zoneNumber: '0009', municipalityId: muni.id }
      });
      const section = await prisma.pollingSection.create({
        data: { sectionNumber: '0013', pollingZoneId: zone.id, expectedBUs: 1 }
      });

      await prisma.election.create({
        data: {
          name: 'Eleição Idempotência',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 2,
              status: 'ACTIVE',
              plei: '2202',
              coverage: { create: { pollingSectionId: section.id, expectedBUs: 1 } }
            }
          },
          scopes: { create: { scopeKey: 'ESTADUAL:AC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      const presDir = path.join(examplesDir, 'Pres-T2_s02202ac0139200090013-imgbu', 'decoded');
      const rawContent = fs.readFileSync(path.join(presDir, 'qrbu-01-of-01.txt'), 'utf8').trim();

      // Primeira leitura
      const res1 = await scanRoute(new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-idempotent-003',
          content: rawContent,
          isSimulation: false
        })
      }));
      expect(res1.status).toBe(200);

      // Segunda leitura em outra sessão
      const res2 = await scanRoute(new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: createAuthHeaders(operatorCsrfToken),
        body: JSON.stringify({
          sessionId: 'session-pr4-idempotent-004',
          content: rawContent,
          isSimulation: false
        })
      }));
      expect(res2.status).toBe(409);
      const data2 = await res2.json();
      expect(data2.status).toBe('DUPLICADO');
    });
  });
});

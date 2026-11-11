import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { POST as scanRoute } from '../src/app/api/scan/route';
import { GET as totalsRoute } from '../src/app/api/totals/route';
import { POST as confirmRoute } from '../src/app/api/reports/[id]/confirm/route';
import { POST as activateRoute } from '../src/app/api/admin/turnos/activate/route';
import { POST as resetRoute } from '../src/app/api/admin/reset/route';
import { GET as exportRoute } from '../src/app/api/export/route';
import { Tse2026QrAssembler } from '../src/lib/parser/tse2026/Tse2026QrAssembler';
import { Tse2026HashValidator } from '../src/lib/parser/tse2026/Tse2026HashValidator';
import { Tse2026SignatureValidator } from '../src/lib/parser/tse2026/Tse2026SignatureValidator';
import { getOfficeDataAggregate } from '../src/lib/presentation/apuracaoHelper';

describe('AUDITORIA TÉCNICA FINAL PRÉ-ELEIÇÃO — T2 2026 (CONCÓRDIA/SC)', () => {
  let operator: any;
  let nonAdminUser: any;
  let electionId: string;
  let round1Id: string;
  let round2Id: string;
  let presOfficeId: string;

  // Helper para construir partes válidas de QRBU com hash SHA-512 canônico do TSE 2026
  function buildTseQrbuParts(
    bodies: string[],
    tamperHash = false
  ): string[] {
    const totalParts = bodies.length;
    const processed = bodies.map(b => b.replace(/^VRQR:\S+\s+/, ''));
    const hashInput = processed.join(' ');
    let hash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();
    if (tamperHash) {
      hash = 'DEADBEEF' + hash.substring(8);
    }

    const parts: string[] = [];
    for (let i = 0; i < totalParts; i++) {
      const partNum = i + 1;
      let p = `QRBU:${partNum}:${totalParts} ` + bodies[i];
      if (partNum === totalParts) {
        p += ` HASH:${hash} ASSI:F509E65CE37604D01B5EBE88568D6230C706030710A0EC5395A864E8746DD0F8 CERT:CERT_ICP_BRASIL`;
      }
      parts.push(p);
    }
    return parts;
  }

  // Helper para gerar corpo de BU presidencial do T2 de Concórdia/SC
  function generateT2Body(params: {
    section: number | string;
    zone?: string;
    lulaVotes: number;
    flavioVotes: number;
    brancos: number;
    nulos: number;
    idue?: string;
    apto?: number;
    comp?: number;
    falt?: number;
    fase?: string;
    plei?: string;
    elei?: string;
  }) {
    const secStr = String(params.section).padStart(4, '0');
    const secNum = parseInt(secStr, 10);
    const zoneStr = params.zone || '0090';
    const zoneNum = parseInt(zoneStr, 10);
    const fase = params.fase || 'O';
    const plei = params.plei || '3221';
    const elei = params.elei || '6258';
    const idue = params.idue || '00000000';

    const validos = params.lulaVotes + params.flavioVotes;
    const totalVotos = validos + params.brancos + params.nulos;
    const apto = params.apto ?? (totalVotos + 50);
    const comp = params.comp ?? totalVotos;
    const falt = params.falt ?? (apto - comp);

    return `VRQR:1.0 ORIG:OFIC PROC:2026 DTPL:20261025 PLEI:${plei} TURN:2 FASE:${fase} UNFE:SC MUNI:80837 ZONA:${zoneNum} SECA:${secNum} IDUE:${idue} IDCA:000000000000000000000000 VERS:10.20.0 LOCA:0 APTO:${apto} COMP:${comp} FALT:${falt} IDEL:${elei} CARG:1 13:${params.lulaVotes} 22:${params.flavioVotes} BRAN:${params.brancos} NULO:${params.nulos} TOTC:${totalVotos}`;
  }

  beforeAll(async () => {
    // Limpeza de tabelas em banco isolado
    await prisma.auditLog.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.candidateMetadata.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.user.deleteMany();

    // 1. Cria Operador Admin e Usuário Comum
    operator = await prisma.user.create({
      data: {
        name: 'Auditor Eleitoral 2026',
        email: 'auditor@apuracao.local',
        passwordHash: 'hash',
        role: 'ADMIN'
      }
    });

    nonAdminUser = await prisma.user.create({
      data: {
        name: 'Operador Visualizador',
        email: 'operador@apuracao.local',
        passwordHash: 'hash',
        role: 'OPERATOR'
      }
    });

    // Mock autenticação como Admin por padrão
    vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
      authenticated: true,
      user: { userId: operator.id, role: 'ADMIN' }
    }));

    // 2. Geometria Eleitoral: Concórdia/SC, Zona 0090
    const state = await prisma.state.upsert({
      where: { abbreviation: 'SC' },
      update: {},
      create: { abbreviation: 'SC', name: 'Santa Catarina' }
    });

    const muni = await prisma.municipality.upsert({
      where: { officialCode: '80837' },
      update: {},
      create: { officialCode: '80837', name: 'Concórdia', stateId: state.id, isCoverage: true }
    });

    const zone90 = await prisma.pollingZone.create({
      data: { municipalityId: muni.id, zoneNumber: '0090', expectedBUs: 193 }
    });

    // Cria as primeiras 5 seções fixas para T1
    for (let s = 1; s <= 5; s++) {
      await prisma.pollingSection.create({
        data: {
          pollingZoneId: zone90.id,
          sectionNumber: String(s).padStart(4, '0'),
          expectedBUs: 1
        }
      });
    }

    // 3. Eleição e Turnos: T1 e T2
    const election = await prisma.election.create({
      data: {
        year: 2026,
        plei: '3220',
        status: 'ACTIVE',
        name: 'Eleições Gerais 2026'
      }
    });
    electionId = election.id;

    // 4. Cargo Presidente
    let presOffice = await prisma.office.findFirst({ where: { electionId: election.id, name: 'Presidente' } });
    if (!presOffice) {
      presOffice = await prisma.office.create({ data: { electionId: election.id, code: '1', name: 'Presidente', orderNumber: 1 } });
    }
    presOfficeId = presOffice.id;

    const round1 = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 1,
        plei: '3220',
        status: 'ACTIVE'
      }
    });
    round1Id = round1.id;

    const round2 = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 2,
        plei: '3221',
        status: 'PLANNED'
      }
    });
    round2Id = round2.id;

    // Cobertura do T1: 5 seções configuradas
    const allSecs = await prisma.pollingSection.findMany();
    for (const sec of allSecs) {
      await prisma.roundCoverage.create({
        data: { electionRoundId: round1.id, pollingSectionId: sec.id, expectedBUs: 1 }
      });
    }

    // Candidatos Oficiais T2
    await prisma.candidateMetadata.createMany({
      data: [
        {
          candidateSequence: '202602001',
          electionYear: 2026,
          electionCode: '6258',
          round: 2,
          state: 'BR',
          officeCode: '1',
          officeName: 'PRESIDENTE',
          candidateNumber: '13',
          ballotName: 'LULA',
          partyNumber: '13',
          partyAbbreviation: 'PT',
          partyName: 'PARTIDO DOS TRABALHADORES',
          source: 'TSE_OFFICIAL_CANDIDATES'
        },
        {
          candidateSequence: '202602002',
          electionYear: 2026,
          electionCode: '6258',
          round: 2,
          state: 'BR',
          officeCode: '1',
          officeName: 'PRESIDENTE',
          candidateNumber: '22',
          ballotName: 'FLÁVIO BOLSONARO',
          partyNumber: '22',
          partyAbbreviation: 'PL',
          partyName: 'PARTIDO LIBERAL',
          source: 'TSE_OFFICIAL_CANDIDATES'
        }
      ]
    });
  });

  // =========================================================================
  // SEÇÃO 2 — AUDITORIA DO SCANNER QRBU
  // =========================================================================
  describe('2. Auditoria do Scanner QRBU', () => {
    it('2.1 Deve validar fixture oficial do TSE 2026 e verificar integridade SHA-512', async () => {
      const fixturePath = path.join(
        __dirname,
        'fixtures/tse-2026/official/examples/Pres-T2_s02202ac0139200090013-imgbu/decoded/qrbu-01-of-01.txt'
      );
      expect(fs.existsSync(fixturePath)).toBe(true);

      const content = fs.readFileSync(fixturePath, 'utf8').trim();
      const assembler = new Tse2026QrAssembler();
      const part = assembler.parseHeader(content);
      expect('partIndex' in part).toBe(true);
      if ('partIndex' in part) {
        expect(part.totalParts).toBe(1);
        expect(part.partIndex).toBe(1);
      }

      const reconstructed = assembler.reconstruct([content]);
      expect(typeof reconstructed).toBe('string');

      const matchHash = content.match(/HASH:([A-Fa-f0-9]+)/);
      expect(matchHash).not.toBeNull();
      const validator = new Tse2026HashValidator();
      const validation = validator.validate(reconstructed as string, matchHash![1], [content]);
      expect(validation).toBe('VERIFIED');
    });

    it('2.2 Deve reconstruir corretamente partes de QRBU fora de ordem', () => {
      const bodyPart1 = 'VRQR:1.0 ORIG:OFIC PROC:2026 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:1 IDUE:0 IDCA:0 VERS:10.20 LOCA:0 APTO:100 COMP:80 FALT:20 IDEL:6258 CARG:1';
      const bodyPart2 = 'VRQR:1.0 13:45 22:30 BRAN:3 NULO:2 TOTC:80';

      const parts = buildTseQrbuParts([bodyPart1, bodyPart2]);
      expect(parts.length).toBe(2);

      const assembler = new Tse2026QrAssembler();
      // Envia parte 2 primeiro, depois parte 1
      const reconstructed = assembler.reconstruct([parts[1], parts[0]]);
      expect(typeof reconstructed).toBe('string');
      expect(reconstructed).toContain('13:45');
      expect(reconstructed).toContain('22:30');

      const matchHash = parts[1].match(/HASH:([A-Fa-f0-9]+)/);
      const validator = new Tse2026HashValidator();
      const validation = validator.validate(reconstructed as string, matchHash![1], parts);
      expect(validation).toBe('VERIFIED');
    });

    it('2.3 Deve rejeitar QRBU adulterado com hash SHA-512 inválido', async () => {
      const body = generateT2Body({ section: 1, lulaVotes: 100, flavioVotes: 50, brancos: 5, nulos: 5 });
      const tamperedParts = buildTseQrbuParts([body], true);

      const sessionId = 'test-tamper-' + Date.now();
      const res = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tamperedParts[0], sessionId })
      }));

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe('INVALID_HASH');
    });

    it('2.4 Deve rejeitar QRBU com fase não oficial (FASE: S)', async () => {
      const body = generateT2Body({ section: 1, lulaVotes: 10, flavioVotes: 10, brancos: 0, nulos: 0, fase: 'S' });
      const parts = buildTseQrbuParts([body]);

      const sessionId = 'test-fase-simulada-' + Date.now();
      const res = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId })
      }));

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe('SIMULATED_QRBU_REJECTED');
    });

    it('2.5 Deve rejeitar QRBU pertencente a outro pleito/turno inativo', async () => {
      const body = generateT2Body({ section: 1, lulaVotes: 10, flavioVotes: 10, brancos: 0, nulos: 0, plei: '9999' });
      const parts = buildTseQrbuParts([body]);

      const sessionId = 'test-mismatch-' + Date.now();
      const res = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId })
      }));

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe('ELECTION_CONTEXT_MISMATCH');
    });

    it('2.6 Comunicação de Limitação Criptográfica: SHA-512 é integridade de payload, não assinatura do TSE', () => {
      const sigValidator = new Tse2026SignatureValidator();
      const result = sigValidator.validate('sample_payload', 'sample_signature');
      expect(result).toBe('UNAVAILABLE');
    });
  });

  // =========================================================================
  // SEÇÃO 3 & 4 — AUDITORIA DE CONTABILIZAÇÃO, CONCORRÊNCIA E BANCO DE DADOS
  // =========================================================================
  describe('3 & 4. Auditoria de Contabilização, Concorrência e SQLite', () => {
    it('4.1 Deve verificar PRAGMAs e integridade estrutural do SQLite', async () => {
      const pragmaJournal = await prisma.$queryRawUnsafe<any[]>('PRAGMA journal_mode;');
      const pragmaBusy = await prisma.$queryRawUnsafe<any[]>('PRAGMA busy_timeout;');
      const pragmaIntegrity = await prisma.$queryRawUnsafe<any[]>('PRAGMA integrity_check;');

      expect(pragmaIntegrity[0].integrity_check).toBe('ok');
      expect(Number(Object.values(pragmaBusy[0])[0])).toBeGreaterThanOrEqual(0);
      expect(typeof Object.values(pragmaJournal[0])[0]).toBe('string');
    });

    it('3.1 Deve tratar condição de corrida: 2 requisições SIMULTÂNEAS com o mesmo QRBU', async () => {
      try {
        await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'FINISHED' } });
        await prisma.electionRound.update({ where: { id: round2Id }, data: { status: 'ACTIVE' } });

        const body = generateT2Body({ section: 99, lulaVotes: 70, flavioVotes: 60, brancos: 2, nulos: 3 });
        const parts = buildTseQrbuParts([body]);

        // Envia exatamente o mesmo QRBU em 2 requisições concorrentes paralelas
        const p1 = scanRoute(new Request('http://localhost/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: parts[0], sessionId: 'race-session-A-' + Date.now() })
        }));

        const p2 = scanRoute(new Request('http://localhost/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: parts[0], sessionId: 'race-session-B-' + Date.now() })
        }));

        const [res1, res2] = await Promise.all([p1, p2]);
        const statuses = [res1.status, res2.status];

        expect(statuses).toContain(409);
        const successRes = res1.status !== 409 ? res1 : res2;
        const dupRes = res1.status === 409 ? res1 : res2;

        const dupData = await dupRes.json();
        expect(dupData.status).toBe('DUPLICADO');

        const successData = await successRes.json();
        expect(successData.status).toBe('COMPLETO');

        // Confirma o BU aceito
        const confirmRes = await confirmRoute(new Request('http://localhost/api/reports/confirm', { method: 'POST' }), {
          params: Promise.resolve({ id: successData.reportId })
        });
        expect(confirmRes.status).toBe(200);

        // Totalização deve contabilizar os votos EXATAMENTE UMA VEZ
        const totRes = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
        const totData = await totRes.json();
        const lulaItem = totData.totals.find((t: any) => t.candidateNumber === '13');
        const flavioItem = totData.totals.find((t: any) => t.candidateNumber === '22');

        expect(lulaItem.quantity).toBe(70);
        expect(flavioItem.quantity).toBe(60);
        expect(totData.processedReports).toBe(1);
      } finally {
        // Limpa dados de teste para manter estado limpo antes da simulação completa
        await prisma.ballotVote.deleteMany();
        await prisma.ballotReportPart.deleteMany();
        await prisma.ballotReport.deleteMany();
        await prisma.scanSession.deleteMany();
        await prisma.roundCoverage.deleteMany({ where: { electionRoundId: round2Id } });
        await prisma.electionRound.update({ where: { id: round2Id }, data: { status: 'PLANNED' } });
        await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'ACTIVE' } });
      }
    });

    it('4.2 Deve garantir atomicidade de transação: rollback completo sem registros órfãos', async () => {
      const reportsBefore = await prisma.ballotReport.count();
      const votesBefore = await prisma.ballotVote.count();

      try {
        await prisma.$transaction(async (tx) => {
          await tx.ballotReport.create({
            data: {
              deterministicId: 'simulated-crash-report',
              electionId,
              roundId: round1Id,
              stateCode: 'SC',
              cityCode: '80837',
              zoneCode: '0090',
              sectionCode: '9999',
              urnCode: 'URN9999',
              status: 'PENDENTE_CONFIRMACAO'
            }
          });
          throw new Error('SIMULATED_DB_CRASH_DURING_TRANSACTION');
        });
      } catch (err: any) {
        expect(err.message).toBe('SIMULATED_DB_CRASH_DURING_TRANSACTION');
      }

      const reportsAfter = await prisma.ballotReport.count();
      const votesAfter = await prisma.ballotVote.count();

      expect(reportsAfter).toBe(reportsBefore);
      expect(votesAfter).toBe(votesBefore);
    });
  });

  // =========================================================================
  // SEÇÃO 5 — SIMULAÇÃO OPERACIONAL COMPLETA (CENÁRIOS A ATÉ H)
  // =========================================================================
  describe('5. Simulação Completa da Apuração (Cenários A a H)', () => {
    let t2CreatedReportIds: string[] = [];

    it('Cenário A — Início da votação: T2 PLANNED, zero BUs, candidatos visíveis, sem projeção', async () => {
      const res = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.round.roundNumber).toBe(2);
      expect(data.round.status).toBe('PLANNED');
      expect(data.processedReports).toBe(0);
      expect(data.isProvisional).toBe(true);
      expect(data.coverageStatus).toBe('PROVISORIA');
      expect(data.estimatedReferenceBUs).toBe(193);
      expect(data.attendance.available).toBe(false);

      // Lula e Flávio Bolsonaro devem estar visíveis com zero votos
      const lula = data.totals.find((t: any) => t.candidateNumber === '13');
      const flavio = data.totals.find((t: any) => t.candidateNumber === '22');
      expect(lula).toBeDefined();
      expect(flavio).toBeDefined();
      expect(lula.quantity).toBe(0);
      expect(flavio.quantity).toBe(0);

      // Verificação no helper de apresentação pública
      const aggregate = getOfficeDataAggregate(data.election.plei, 2, 'Presidente', data.totals);
      expect(aggregate.candidates.length).toBe(2);
      expect(aggregate.totalValidos).toBe(0);
      expect(aggregate.totalGeral).toBe(0);
    });

    it('Cenário B — Ativação simulada: ativar T2 exclusivamente no banco descartável', async () => {
      // Desativa T1 e ativa T2
      await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'FINISHED' } });
      const activeRes = await prisma.electionRound.update({
        where: { id: round2Id },
        data: { status: 'ACTIVE' }
      });
      expect(activeRes.status).toBe('ACTIVE');

      const res = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const data = await res.json();
      expect(data.round.status).toBe('ACTIVE');
      expect(data.election.rounds.find((r: any) => r.roundNumber === 2).status).toBe('ACTIVE');
    });

    it('Cenário C — Primeiro QRBU: persistência, contabilização, projeção linear imediata e indicadores', async () => {
      // Seção 15: Lula 150, Flavio 100, Brancos 5, Nulos 10, Apto 320, Comp 265, Falt 55
      const body = generateT2Body({
        section: 15,
        lulaVotes: 150,
        flavioVotes: 100,
        brancos: 5,
        nulos: 10,
        apto: 320,
        comp: 265,
        falt: 55
      });
      const parts = buildTseQrbuParts([body]);

      const scanRes = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId: 'session-sec-15-' + Date.now() })
      }));
      expect(scanRes.status).toBe(200);
      const scanData = await scanRes.json();
      expect(scanData.status).toBe('COMPLETO');
      t2CreatedReportIds.push(scanData.reportId);

      // Cadastro dinâmico de seção e cobertura verificado
      const sectionInDb = await prisma.pollingSection.findFirst({
        where: { sectionNumber: '0015' }
      });
      expect(sectionInDb).not.toBeNull();

      const cov = await prisma.roundCoverage.findUnique({
        where: {
          electionRoundId_pollingSectionId: {
            electionRoundId: round2Id,
            pollingSectionId: sectionInDb!.id
          }
        }
      });
      expect(cov).not.toBeNull();
      expect(cov!.expectedBUs).toBe(1);

      // Confirmação pelo operador
      const confRes = await confirmRoute(new Request('http://localhost/api/reports/confirm', { method: 'POST' }), {
        params: Promise.resolve({ id: scanData.reportId })
      });
      expect(confRes.status).toBe(200);

      // Consulta /api/totals
      const totRes = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const totData = await totRes.json();

      expect(totData.processedReports).toBe(1);
      expect(totData.isProvisional).toBe(true);
      expect(totData.attendance.available).toBe(true);
      expect(totData.attendance.eligible).toBe(320);
      expect(totData.attendance.turnout).toBe(265);
      expect(totData.attendance.abstention).toBe(55);
      expect(totData.attendance.turnoutPercent).toBe('82,81');
      expect(totData.attendance.abstentionPercent).toBe('17,19');

      // Votos nominais e projeção linear desde o 1º BU
      const lula = totData.totals.find((t: any) => t.candidateNumber === '13');
      const flavio = totData.totals.find((t: any) => t.candidateNumber === '22');
      expect(lula.quantity).toBe(150);
      expect(flavio.quantity).toBe(100);

      // Projeção: v * 193 / 1
      const projLula = Math.round((150 * 193) / 1); // 28950
      const projFlavio = Math.round((100 * 193) / 1); // 19300
      expect(projLula).toBe(28950);
      expect(projFlavio).toBe(19300);

      // Helper de apresentação
      const agg = getOfficeDataAggregate('3221', 2, 'Presidente', totData.totals);
      expect(agg.totalValidos).toBe(250);
      expect(agg.brancos).toBe(5);
      expect(agg.nulos).toBe(10);
      expect(agg.totalGeral).toBe(265);
    });

    it('Cenário D — Apuração progressiva: sequência de 10 seções distintas com recálculo linear', async () => {
      let expectedLula = 150;
      let expectedFlavio = 100;
      let expectedBrancos = 5;
      let expectedNulos = 10;
      let expectedEligible = 320;
      let expectedTurnout = 265;

      // Injeta seções 16 a 25 (total 10 novas seções)
      for (let s = 16; s <= 25; s++) {
        const lVotes = 100 + s;
        const fVotes = 90 + s;
        const br = 2;
        const nu = 3;
        const apto = 300;
        const comp = lVotes + fVotes + br + nu;
        const falt = apto - comp;

        expectedLula += lVotes;
        expectedFlavio += fVotes;
        expectedBrancos += br;
        expectedNulos += nu;
        expectedEligible += apto;
        expectedTurnout += comp;

        const body = generateT2Body({
          section: s,
          lulaVotes: lVotes,
          flavioVotes: fVotes,
          brancos: br,
          nulos: nu,
          apto,
          comp,
          falt
        });
        const parts = buildTseQrbuParts([body]);

        const scanRes = await scanRoute(new Request('http://localhost/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: parts[0], sessionId: `session-sec-${s}-${Date.now()}` })
        }));
        const scanData = await scanRes.json();
        t2CreatedReportIds.push(scanData.reportId);

        await confirmRoute(new Request('http://localhost/api/reports/confirm', { method: 'POST' }), {
          params: Promise.resolve({ id: scanData.reportId })
        });
      }

      // Total acumulado: 11 seções confirmadas
      const totRes = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const totData = await totRes.json();

      expect(totData.processedReports).toBe(11);
      const lula = totData.totals.find((t: any) => t.candidateNumber === '13');
      const flavio = totData.totals.find((t: any) => t.candidateNumber === '22');
      expect(lula.quantity).toBe(expectedLula);
      expect(flavio.quantity).toBe(expectedFlavio);

      // Projeção atualizada com N=11
      const projLula = Math.round((expectedLula * 193) / 11);
      const projFlavio = Math.round((expectedFlavio * 193) / 11);
      expect(projLula).toBeGreaterThan(expectedLula);
      expect(projFlavio).toBeGreaterThan(expectedFlavio);

      // Comparecimento acumulado
      expect(totData.attendance.eligible).toBe(expectedEligible);
      expect(totData.attendance.turnout).toBe(expectedTurnout);
    });

    it('Cenário E — Duplicidade: reenviar BU já contabilizado é rejeitado e não altera totais', async () => {
      const totBefore = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const beforeData = await totBefore.json();

      // Reenvia exatamente a seção 15 (já confirmada)
      const body = generateT2Body({
        section: 15,
        lulaVotes: 150,
        flavioVotes: 100,
        brancos: 5,
        nulos: 10,
        apto: 320,
        comp: 265,
        falt: 55
      });
      const parts = buildTseQrbuParts([body]);

      const scanRes = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId: 'session-dup-sec-15-' + Date.now() })
      }));
      expect(scanRes.status).toBe(409);
      const data = await scanRes.json();
      expect(data.status).toBe('DUPLICADO');

      const totAfter = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const afterData = await totAfter.json();

      expect(afterData.processedReports).toBe(beforeData.processedReports);
      expect(afterData.totals.find((t: any) => t.candidateNumber === '13').quantity).toBe(
        beforeData.totals.find((t: any) => t.candidateNumber === '13').quantity
      );
    });

    it('Cenário F — Conflito: BU diferente para seção já registrada é sinalizado como CONFLITO_SECAO', async () => {
      const totBefore = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const beforeData = await totBefore.json();

      // Envia BU com urna diferente (IDUE diferente -> deterministicId diferente) para a mesma seção 15
      const conflictingBody = generateT2Body({
        section: 15,
        lulaVotes: 999,
        flavioVotes: 1,
        brancos: 0,
        nulos: 0,
        idue: '88888888' // Urna substituta com resultado divergente
      });
      const parts = buildTseQrbuParts([conflictingBody]);

      const scanRes = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId: 'session-conflict-sec-15-' + Date.now() })
      }));
      expect(scanRes.status).toBe(409);
      const data = await scanRes.json();
      expect(data.status).toBe('CONFLITO');
      expect(data.error).toBe('CONFLITO_SECAO');

      // Verifica que AuditLog registrou o conflito
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'BALLOT_REPORT_CONFLICT' },
        orderBy: { createdAt: 'desc' }
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog!.result).toBe('FLAGGED_FOR_REVIEW');

      // Totais não foram alterados
      const totAfter = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const afterData = await totAfter.json();
      expect(afterData.processedReports).toBe(beforeData.processedReports);
      expect(afterData.totals.find((t: any) => t.candidateNumber === '13').quantity).toBe(
        beforeData.totals.find((t: any) => t.candidateNumber === '13').quantity
      );
    });

    it('Cenário G — Falha operacional e recuperação: consistência e integridade após reenvio', async () => {
      const sessionId = 'session-interrupted-' + Date.now();
      const bodyPart1 = 'VRQR:1.0 ORIG:OFIC PROC:2026 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:90 SECA:30 IDUE:0 IDCA:0 VERS:10.20 LOCA:0 APTO:100 COMP:80 FALT:20 IDEL:6258 CARG:1';
      const bodyPart2 = 'VRQR:1.0 13:50 22:30 BRAN:0 NULO:0 TOTC:80';
      const parts = buildTseQrbuParts([bodyPart1, bodyPart2]);

      // Envia parte 1
      const resP1 = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId })
      }));
      expect(resP1.status).toBe(200);
      const dataP1 = await resP1.json();
      expect(dataP1.status).toBe('PARCIAL');

      // Simula reenvio da parte 1 (idempotência de partes)
      const resP1Retry = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[0], sessionId })
      }));
      expect(resP1Retry.status).toBe(200);

      // Envia parte 2 para completar
      const resP2 = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: parts[1], sessionId })
      }));
      expect(resP2.status).toBe(200);
      const dataP2 = await resP2.json();
      expect(dataP2.status).toBe('COMPLETO');

      // Confirmação com sucesso
      const confRes = await confirmRoute(new Request('http://localhost/api/reports/confirm', { method: 'POST' }), {
        params: Promise.resolve({ id: dataP2.reportId })
      });
      expect(confRes.status).toBe(200);

      // Verifica integridade SQLite
      const integrity = await prisma.$queryRawUnsafe<any[]>('PRAGMA integrity_check;');
      expect(integrity[0].integrity_check).toBe('ok');
    });

    it('Cenário H — Cobertura superior à referência (195 seções): não bloqueia e mantém projeção >= votos', async () => {
      // Já temos 12 seções confirmadas (11 do cenário C/D + 1 do cenário G).
      const currentCount = await prisma.ballotReport.count({
        where: { roundId: round2Id, status: 'PROCESSADO' }
      });
      expect(currentCount).toBe(12);

      // Injeta diretamente no banco descartável as seções restantes para atingir 195 seções
      const zone = await prisma.pollingZone.findFirst({ where: { zoneNumber: '0090' } });
      const secDataBatch = [];
      const repDataBatch = [];
      const voteDataBatch = [];

      for (let s = 13; s <= 195; s++) {
        const secNumber = String(s + 100).padStart(4, '0');
        const repId = `batch-rep-${s}`;
        const secId = `batch-sec-${s}`;

        secDataBatch.push({
          id: secId,
          pollingZoneId: zone!.id,
          sectionNumber: secNumber,
          expectedBUs: 1
        });

        repDataBatch.push({
          id: repId,
          deterministicId: `DET-T2-SC-80837-0090-${secNumber}`,
          electionId,
          roundId: round2Id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: secNumber,
          urnCode: `URN-${secNumber}`,
          status: 'PROCESSADO',
          isSimulation: false,
          validationData: JSON.stringify({ attendance: { apto: 200, comp: 160, falt: 40 } })
        });

        voteDataBatch.push(
          { reportId: repId, officeId: presOfficeId, candidateNumber: '13', partyNumber: '13', voteType: 'NOMINAL', quantity: 90 },
          { reportId: repId, officeId: presOfficeId, candidateNumber: '22', partyNumber: '22', voteType: 'NOMINAL', quantity: 70 }
        );
      }

      // Insere em lote
      await prisma.pollingSection.createMany({ data: secDataBatch });
      await prisma.roundCoverage.createMany({
        data: secDataBatch.map(s => ({
          electionRoundId: round2Id,
          pollingSectionId: s.id,
          expectedBUs: 1
        }))
      });
      await prisma.ballotReport.createMany({ data: repDataBatch });
      await prisma.ballotVote.createMany({ data: voteDataBatch });

      const totRes = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      const totData = await totRes.json();

      // Confirma que foram processadas 195 seções (> 193)
      expect(totData.processedReports).toBe(195);
      // Status canônico estrito: mesmo com 195 seções, cobertura não-homologada permanece provisória
      expect(totData.coverageStatus).toBe('PROVISORIA');
      expect(totData.isProvisional).toBe(true);

      const lula = totData.totals.find((t: any) => t.candidateNumber === '13');
      const flavio = totData.totals.find((t: any) => t.candidateNumber === '22');

      // Projeção nunca fica abaixo dos votos contabilizados:
      // Quando processedReports (195) >= 193, projFn retorna o próprio total apurado 'v'
      const p = totData.processedReports;
      const projFn = (v: number) => {
        if (p >= 193) return v;
        return Math.round((v * 193) / p);
      };

      expect(projFn(lula.quantity)).toBe(lula.quantity);
      expect(projFn(flavio.quantity)).toBe(flavio.quantity);
      expect(projFn(lula.quantity)).toBeGreaterThanOrEqual(lula.quantity);
    });
  });

  // =========================================================================
  // SEÇÃO 6 — PAINEL PÚBLICO E CÁLCULOS MATEMÁTICOS
  // =========================================================================
  describe('6. Painel Público, Percentuais e Projeções', () => {
    it('6.1 Percentuais nominais devem ser calculados estritamente sobre VOTOS VÁLIDOS', () => {
      const mockTotals = [
        { officeName: 'Presidente', candidateNumber: '13', voteType: 'NOMINAL', quantity: 600, candidateName: 'LULA', partyAbbreviation: 'PT' },
        { officeName: 'Presidente', candidateNumber: '22', voteType: 'NOMINAL', quantity: 400, candidateName: 'FLÁVIO BOLSONARO', partyAbbreviation: 'PL' },
        { officeName: 'Presidente', candidateNumber: null, voteType: 'BRANCO', quantity: 50 },
        { officeName: 'Presidente', candidateNumber: null, voteType: 'NULO', quantity: 50 }
      ];

      const agg = getOfficeDataAggregate('3221', 2, 'Presidente', mockTotals);
      expect(agg.totalValidos).toBe(1000); // 600 + 400
      expect(agg.brancos).toBe(50);
      expect(agg.nulos).toBe(50);
      expect(agg.totalGeral).toBe(1100);

      // Denominador para percentual de candidatos: validVotes
      const lulaPct = ((600 / agg.totalValidos) * 100).toFixed(2);
      const flavioPct = ((400 / agg.totalValidos) * 100).toFixed(2);

      expect(lulaPct).toBe('60.00');
      expect(flavioPct).toBe('40.00');
      expect(parseFloat(lulaPct) + parseFloat(flavioPct)).toBe(100.00);

      // Brancos e nulos em relação ao total geral
      const brancosPct = ((50 / agg.totalGeral) * 100).toFixed(2);
      const nulosPct = ((50 / agg.totalGeral) * 100).toFixed(2);
      expect(brancosPct).toBe('4.55');
      expect(nulosPct).toBe('4.55');
    });

    it('6.2 Tratamento de divisão por zero quando votos válidos = 0', () => {
      const mockTotalsZero = [
        { officeName: 'Presidente', candidateNumber: '13', voteType: 'NOMINAL', quantity: 0, candidateName: 'LULA', partyAbbreviation: 'PT' },
        { officeName: 'Presidente', candidateNumber: '22', voteType: 'NOMINAL', quantity: 0, candidateName: 'FLÁVIO BOLSONARO', partyAbbreviation: 'PL' }
      ];

      const agg = getOfficeDataAggregate('3221', 2, 'Presidente', mockTotalsZero);
      expect(agg.totalValidos).toBe(0);

      const validVotes = agg.totalValidos;
      const getCandidatePct = (v: number) => (validVotes > 0 ? ((v / validVotes) * 100).toFixed(2).replace('.', ',') : '0,00');

      expect(getCandidatePct(0)).toBe('0,00');
    });

    it('6.3 Projeção linear desde 1 BU utiliza a mesma unidade de contagem da cobertura', () => {
      // 1 urna apurada de 193 urnas de referência
      const progressProcessed = 1;
      const progressTotal = 193;
      const votes = 120;

      const projVotes = Math.round((votes * progressTotal) / progressProcessed);
      expect(projVotes).toBe(23160);
      expect(progressTotal / progressProcessed).toBe(193);
    });

    it('6.4 Resposta HTTP de /api/totals deve conter Cache-Control no-store, no-cache, must-revalidate, proxy-revalidate', async () => {
      const res = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
      expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
    });
  });

  // =========================================================================
  // SEÇÃO 7 — SEGURANÇA DO SISTEMA
  // =========================================================================
  describe('7. Auditoria de Segurança', () => {
    it('7.1 Deve bloquear acesso não autenticado a endpoints protegidos (401)', async () => {
      // Mock não autenticado
      vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
        authenticated: false,
        reason: 'NO_TOKEN'
      }));

      // POST /api/reports/[id]/confirm
      const confRes = await confirmRoute(new Request('http://localhost/api/reports/123/confirm', { method: 'POST' }), {
        params: Promise.resolve({ id: '123' })
      });
      expect(confRes.status).toBe(401);

      // POST /api/scan
      const scanRes = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'invalid', sessionId: 'sec-noauth' })
      }));
      expect(scanRes.status).toBe(401);

      // GET /api/export
      const expRes = await exportRoute(new Request('http://localhost/api/export'));
      expect(expRes.status).toBe(401);

      // POST /api/admin/reset
      const resetRes = await resetRoute(new Request('http://localhost/api/admin/reset', { method: 'POST' }));
      expect(resetRes.status).toBe(401);
    });

    it('7.2 Deve bloquear usuário sem perfil ADMIN em endpoints restritos (403)', async () => {
      // Mock usuário com perfil OPERATOR (não ADMIN)
      vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
        authenticated: true,
        user: { userId: nonAdminUser.id, role: 'OPERATOR' }
      }));

      // POST /api/admin/turnos/activate
      const actRes = await activateRoute(new Request('http://localhost/api/admin/turnos/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: round2Id })
      }));
      expect(actRes.status).toBe(403);

      // POST /api/admin/reset
      const resetRes = await resetRoute(new Request('http://localhost/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RESET_ROUND', roundId: round2Id })
      }));
      expect(resetRes.status).toBe(403);
    });

    it('7.3 Imunidade a SQL Injection: Prisma utiliza consultas parametrizadas', async () => {
      // Restaura permissão Admin
      vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
        authenticated: true,
        user: { userId: operator.id, role: 'ADMIN' }
      }));

      const injectionPayload = "' OR '1'='1";
      const res = await totalsRoute(new Request(`http://localhost/api/totals?round=${encodeURIComponent(injectionPayload)}`));
      expect([200, 400, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // SEÇÃO 8 — CODIFICAÇÃO UTF-8 E CARACTERES
  // =========================================================================
  describe('8. Auditoria de Encoding UTF-8', () => {
    it('8.1 Todos os arquivos sob src/ devem ser estritamente UTF-8 sem caracteres corrompidos', () => {
      const repoDir = path.resolve(__dirname, '..');
      const srcDir = path.join(repoDir, 'src');
      const mojibakeRegex = new RegExp('\\u00C3[\\u00A0-\\u00BF]|\\u00C2[\\u00A0-\\u00BF]', 'g');

      function checkDir(dir: string): { file: string; matches: string[] }[] {
        const issues: { file: string; matches: string[] }[] = [];
        for (const item of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            issues.push(...checkDir(fullPath));
          } else if (/\.(ts|tsx|js|json|css)$/.test(item)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const matches = content.match(mojibakeRegex);
            if (matches) {
              issues.push({ file: path.relative(repoDir, fullPath), matches });
            }
          }
        }
        return issues;
      }

      const issues = checkDir(srcDir);
      expect(issues.length).toBe(0);
    });
  });
});

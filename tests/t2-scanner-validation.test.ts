import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { POST as scanRoute } from '../src/app/api/scan/route';
import { GET as totalsRoute } from '../src/app/api/totals/route';

describe('Validação Operacional do Scanner T2 e API /api/scan', () => {
  let operator: any;
  let electionId: string;
  let round1Id: string;
  let round2Id: string;
  let sec90Id: string;
  let sec125Id: string;
  let presOfficeId: string;
  let t2ReportId: string;

  // Helper para gerar SHA-512 canônico das partes do QRBU
  function buildQrbuParts(bodies: string[], fase = 'O') {
    const totalParts = bodies.length;
    const processed = bodies.map(b => b.replace(/^VRQR:\S+\s+/, ''));
    const hashInput = processed.join(' ');
    const hash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();

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

  beforeAll(async () => {
    // Limpeza prévia
    await prisma.roundCoverage.deleteMany();
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.candidateMetadata.deleteMany();

    // Cria Operador
    operator = await prisma.user.create({
      data: {
        name: 'Operador Scanner T2',
        email: `op-t2-${Date.now()}@apuracao.local`,
        passwordHash: 'hash',
        role: 'ADMIN'
      }
    });

    vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
      authenticated: true,
      user: { userId: operator.id, role: 'ADMIN' }
    }));

    // Configuração Geográfica Concórdia/SC
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

    let zone90 = await prisma.pollingZone.findFirst({
      where: { municipalityId: muni.id, zoneNumber: '0090' }
    });
    if (!zone90) {
      zone90 = await prisma.pollingZone.create({
        data: { municipalityId: muni.id, zoneNumber: '0090', expectedBUs: 193 }
      });
    }

    let sec90 = await prisma.pollingSection.findFirst({
      where: { pollingZoneId: zone90.id, sectionNumber: '0090' }
    });
    if (!sec90) {
      sec90 = await prisma.pollingSection.create({
        data: { pollingZoneId: zone90.id, sectionNumber: '0090', expectedBUs: 1 }
      });
    }
    sec90Id = sec90.id;

    let sec125 = await prisma.pollingSection.findFirst({
      where: { pollingZoneId: zone90.id, sectionNumber: '0125' }
    });
    if (!sec125) {
      sec125 = await prisma.pollingSection.create({
        data: { pollingZoneId: zone90.id, sectionNumber: '0125', expectedBUs: 0 }
      });
    }
    sec125Id = sec125.id;

    // Eleição e Turnos
    const election = await prisma.election.create({
      data: {
        year: 2026,
        plei: '3220',
        status: 'ACTIVE',
        name: 'Eleições Gerais 2026'
      }
    });
    electionId = election.id;

    // Round 1 (FINISHED, plei 3220)
    const round1 = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 1,
        plei: '3220',
        status: 'FINISHED'
      }
    });
    round1Id = round1.id;

    // Round 2 (ACTIVE para teste do scanner T2, plei 3221)
    const round2 = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 2,
        plei: '3221',
        status: 'ACTIVE'
      }
    });
    round2Id = round2.id;

    // RoundCoverage para Round 1
    await prisma.roundCoverage.create({
      data: { electionRoundId: round1.id, pollingSectionId: sec90.id, expectedBUs: 1 }
    });

    // RoundCoverage para Round 2: seção 0090 elegível (expectedBUs = 1)
    await prisma.roundCoverage.create({
      data: { electionRoundId: round2.id, pollingSectionId: sec90.id, expectedBUs: 1 }
    });
    // RoundCoverage para Round 2: seção 0125 agregada (expectedBUs = 0)
    await prisma.roundCoverage.create({
      data: { electionRoundId: round2.id, pollingSectionId: sec125.id, expectedBUs: 0 }
    });

    // Cargo Presidente
    let presOffice = await prisma.office.findFirst({ where: { electionId: election.id, name: 'Presidente' } });
    if (!presOffice) {
      presOffice = await prisma.office.create({ data: { electionId: election.id, code: '1', name: 'Presidente', orderNumber: 1 } });
    }
    presOfficeId = presOffice.id;

    // Metadados T1
    await prisma.candidateMetadata.createMany({
      data: [
        {
          candidateSequence: '90001',
          electionYear: 2026,
          electionCode: '6257',
          round: 1,
          state: 'BR',
          officeCode: '1',
          officeName: 'PRESIDENTE',
          candidateNumber: '13',
          ballotName: 'LULA R1',
          partyNumber: '13',
          partyAbbreviation: 'PT',
          partyName: 'PT',
          source: 'test'
        },
        {
          candidateSequence: '90002',
          electionYear: 2026,
          electionCode: '6257',
          round: 1,
          state: 'BR',
          officeCode: '1',
          officeName: 'PRESIDENTE',
          candidateNumber: '22',
          ballotName: 'BOLSONARO R1',
          partyNumber: '22',
          partyAbbreviation: 'PL',
          partyName: 'PL',
          source: 'test'
        }
      ]
    });

    // Metadados T2 (Presidente: 13 Lula, 22 Flávio Bolsonaro)
    await prisma.candidateMetadata.createMany({
      data: [
        {
          candidateSequence: '90003',
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
          partyName: 'PT',
          source: 'tse-official-t2'
        },
        {
          candidateSequence: '90004',
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
          partyName: 'PL',
          source: 'tse-official-t2'
        }
      ]
    });

    // Inserir BU prévio do T1 no banco
    await prisma.ballotReport.create({
      data: {
        deterministicId: '3220-1-SC-80837-0090-0090-URNAT1',
        electionId: election.id,
        roundId: round1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '0090',
        sectionCode: '0090',
        urnCode: 'URNAT1',
        hash: 'HASH_T1_PREVIO',
        signature: 'SIG_T1_PREVIO',
        status: 'PROCESSADO',
        isSimulation: false,
        validationData: JSON.stringify({ parsed: true, hashStatus: 'VERIFIED', sigStatus: 'UNAVAILABLE' }),
        votes: {
          create: [
            { officeId: presOfficeId, voteType: 'NOMINAL', candidateNumber: '13', quantity: 110 },
            { officeId: presOfficeId, voteType: 'NOMINAL', candidateNumber: '22', quantity: 90 }
          ]
        }
      }
    });
  });

  afterAll(async () => {
    await prisma.roundCoverage.deleteMany();
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.candidateMetadata.deleteMany();
  });

  // -------------------------------------------------------------------------
  // 1. Leitura e reconstrução de QRBU multipart
  // 2. Interpretação de PLEI=3221, TURN=2, IDEL=6258 e CARG=1
  // -------------------------------------------------------------------------
  it('1 e 2. Deve reconstruir QRBU multipart T2 e interpretar PLEI=3221, TURN=2, IDEL=6258 e CARG=1', async () => {
    const t2Bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0090 AGRE: IDUE:9900001 IDCA:990000000000000000000001 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:55 22:45',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const t2Parts = buildQrbuParts(t2Bodies, 'O');
    const sessionId = `SESSION-T2-${Date.now()}`;

    // Parte 1: status PARCIAL
    const reqPart1 = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: t2Parts[0], sessionId, isSimulation: false })
    });
    const resPart1 = await scanRoute(reqPart1);
    const jsonPart1 = await resPart1.json();

    expect(resPart1.status).toBe(200);
    expect(jsonPart1.status).toBe('PARCIAL');
    expect(jsonPart1.partsRead).toBe(1);
    expect(jsonPart1.totalParts).toBe(2);

    // Parte 2: status COMPLETO
    const reqPart2 = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: t2Parts[1], sessionId, isSimulation: false })
    });
    const resPart2 = await scanRoute(reqPart2);
    const jsonPart2 = await resPart2.json();

    expect(resPart2.status).toBe(200);
    expect(jsonPart2.status).toBe('COMPLETO');
    expect(jsonPart2.reportId).toBeDefined();

    t2ReportId = jsonPart2.reportId;

    // Validação dos dados gravados no banco
    const report = await prisma.ballotReport.findUnique({
      where: { id: t2ReportId },
      include: { votes: true }
    });

    expect(report).not.toBeNull();
    expect(report?.roundId).toBe(round2Id);
    expect(report?.stateCode).toBe('SC');
    expect(report?.cityCode).toBe('80837');
    expect(report?.zoneCode).toBe('0090');
    expect(report?.sectionCode).toBe('0090');
    expect(report?.deterministicId).toBe('3221-2-SC-80837-0090-0090-9900001');

    // Validação de votos (candidato 13 e 22 nominais + votos em branco e nulo)
    expect(report?.votes.length).toBe(4);
    expect(report?.votes.filter(v => v.voteType === 'NOMINAL').length).toBe(2);
    const v13 = report?.votes.find(v => v.candidateNumber === '13');
    const v22 = report?.votes.find(v => v.candidateNumber === '22');
    expect(v13?.quantity).toBe(55);
    expect(v22?.quantity).toBe(45);
  });

  // -------------------------------------------------------------------------
  // 3. Rejeição de QRBU do T1 quando T2 estiver ativo
  // -------------------------------------------------------------------------
  it('3. Deve rejeitar QRBU do T1 quando T2 estiver ativo (ELECTION_CONTEXT_MISMATCH)', async () => {
    const t1Bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2100 DTPL:20261004 PLEI:3220 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0090 AGRE: IDUE:9900002 IDCA:990000000000000000000002 VERS:10.20.0.0 LOCA:1 APTO:100 COMP:80 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261004 HRAB:080000 DTFC:20261004 HRFC:170000 IDEL:2111 CARG:1 TIPO:0 VERC:00 13:40 22:40'
    ];
    const t1Parts = buildQrbuParts(t1Bodies, 'O');
    const sessionId = `SESSION-T1-${Date.now()}`;

    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: t1Parts[0], sessionId, isSimulation: false })
    });
    const res = await scanRoute(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('ELECTION_CONTEXT_MISMATCH');
  });

  // -------------------------------------------------------------------------
  // 4. Rejeição de zona ou seção fora do escopo configurado
  // -------------------------------------------------------------------------
  it('4. Deve rejeitar zona ou município fora da área de cobertura (OUT_OF_COVERAGE)', async () => {
    const oocBodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:81000 ZONA:0090 SECA:0001 AGRE: IDUE:9900003 IDCA:990000000000000000000003 VERS:10.20.0.0 LOCA:1 APTO:100 COMP:80 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:30'
    ];
    const oocParts = buildQrbuParts(oocBodies, 'O');
    const sessionId = `SESSION-OOC-${Date.now()}`;

    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: oocParts[0], sessionId, isSimulation: false })
    });
    const res = await scanRoute(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('OUT_OF_COVERAGE');
  });

  // -------------------------------------------------------------------------
  // 5. Rejeição de seção agregada sem BU próprio (expectedBUs <= 0)
  // -------------------------------------------------------------------------
  it('5. Deve rejeitar seção agregada sem BU independente (SECTION_AGGREGATED_NO_BU)', async () => {
    const aggBodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0125 AGRE: IDUE:9900004 IDCA:990000000000000000000004 VERS:10.20.0.0 LOCA:1 APTO:100 COMP:80 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:30'
    ];
    const aggParts = buildQrbuParts(aggBodies, 'O');
    const sessionId = `SESSION-AGG-${Date.now()}`;

    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: aggParts[0], sessionId, isSimulation: false })
    });
    const res = await scanRoute(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('SECTION_AGGREGATED_NO_BU');
  });

  // -------------------------------------------------------------------------
  // 6. Rejeição de QRBU de teste/simulado em modo oficial
  // -------------------------------------------------------------------------
  it('6A. Deve rejeitar payload SIMULATION| em modo oficial', async () => {
    const simPayload = `SIMULATION|1|1|SEQ-SIM|3221|2|SC|80837|0090|0090|URNASIM|Presidente,13,13,NOMINAL,50|hashsim|sigsim`;
    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: simPayload, sessionId: `SESSION-SIM-A-${Date.now()}`, isSimulation: false })
    });
    const res = await scanRoute(req);
    expect(res.status).toBe(400);
  });

  it('6B. Deve rejeitar QRBU com FASE:S (simulado) em modo oficial', async () => {
    const simBodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:S UNFE:SC MUNI:80837 ZONA:0090 SECA:0090 AGRE: IDUE:9900005 IDCA:990000000000000000000005 VERS:10.20.0.0 LOCA:1 APTO:100 COMP:80 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:30'
    ];
    const simParts = buildQrbuParts(simBodies, 'S');
    const req = new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: simParts[0], sessionId: `SESSION-SIM-B-${Date.now()}`, isSimulation: false })
    });
    const res = await scanRoute(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('SIMULATED_QRBU_REJECTED');
  });

  // -------------------------------------------------------------------------
  // 7. Totalização correta dos votos do T2 sem misturar com T1
  // -------------------------------------------------------------------------
  it('7. Deve totalizar votos do T2 sem misturar com T1 e preservar dados do T1', async () => {
    // Atualiza o relatório do T2 para PROCESSADO para simular aprovação
    await prisma.ballotReport.update({
      where: { id: t2ReportId },
      data: { status: 'PROCESSADO' }
    });

    // Totalização T1
    const reqT1 = new Request('http://localhost/api/totals?round=1');
    const resT1 = await totalsRoute(reqT1);
    const jsonT1 = await resT1.json();

    expect(resT1.status).toBe(200);
    expect(jsonT1.processedReports).toBe(1);
    const t1Cand13 = jsonT1.totals.find((t: any) => t.candidateNumber === '13');
    const t1Cand22 = jsonT1.totals.find((t: any) => t.candidateNumber === '22');
    expect(t1Cand13?.quantity).toBe(110);
    expect(t1Cand22?.quantity).toBe(90);

    // Totalização T2 (round ACTIVE)
    const reqT2 = new Request('http://localhost/api/totals?round=2');
    const resT2 = await totalsRoute(reqT2);
    const jsonT2 = await resT2.json();

    expect(resT2.status).toBe(200);
    expect(jsonT2.processedReports).toBe(1);
    const t2Cand13 = jsonT2.totals.find((t: any) => t.candidateNumber === '13');
    const t2Cand22 = jsonT2.totals.find((t: any) => t.candidateNumber === '22');
    expect(t2Cand13?.quantity).toBe(55);
    expect(t2Cand22?.quantity).toBe(45);
  });

  // -------------------------------------------------------------------------
  // 8. Assinatura não marcada falsamente como verificada criptograficamente
  // -------------------------------------------------------------------------
  it('8. Não deve marcar assinatura do QRBU falsamente como verificada criptograficamente', async () => {
    const report = await prisma.ballotReport.findUnique({
      where: { id: t2ReportId }
    });

    expect(report).not.toBeNull();
    const valData = JSON.parse(report?.validationData || '{}');

    // Hash SHA-512 é VERIFIED (integridade física/estrutural de leitura)
    expect(valData.hashStatus).toBe('VERIFIED');
    // Assinatura digital é UNAVAILABLE (sem chaves públicas off-band do TSE)
    expect(valData.sigStatus).toBe('UNAVAILABLE');
    expect(valData.sigStatus).not.toBe('VERIFIED');
  });
});

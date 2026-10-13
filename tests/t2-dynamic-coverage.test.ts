import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { POST as scanRoute } from '../src/app/api/scan/route';
import { GET as totalsRoute } from '../src/app/api/totals/route';
import { POST as confirmRoute } from '../src/app/api/reports/[id]/confirm/route';

describe('Eleições 2026 — Segundo Turno: Aceitação Dinâmica e Cobertura Provisória', () => {
  let operator: any;
  let electionId: string;
  let round1Id: string;
  let round2Id: string;
  let presOfficeId: string;

  // Helper para construir partes válidas de QRBU com hash SHA-512 canônico
  function buildQrbu(bodies: string[], fase = 'O') {
    const totalParts = bodies.length;
    const processed = bodies.map(b => b.replace(/^VRQR:\S+\s+/, ''));
    const hashInput = processed.join(' ');
    const hash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();

    const parts: string[] = [];
    for (let i = 0; i < totalParts; i++) {
      const partNum = i + 1;
      let p = `QRBU:${partNum}:${totalParts} ` + bodies[i];
      if (partNum === totalParts) {
        p += ` HASH:${hash} ASSI:DUMMY_SIGNATURE_T2_HEX CERT:CERT_ICP_BRASIL`;
      }
      parts.push(p);
    }
    return parts;
  }

  beforeAll(async () => {
    // 1. Limpeza segura de tabelas
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

    // 2. Operador autenticado
    operator = await prisma.user.create({
      data: {
        name: 'Operador Teste Dinâmico T2',
        email: `op-dynamic-t2-${Date.now()}@apuracao.local`,
        passwordHash: 'hash',
        role: 'ADMIN'
      }
    });

    vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
      authenticated: true,
      user: { userId: operator.id, role: 'ADMIN' }
    }));

    // 3. Estrutura territorial homologada: Concórdia/SC, Zona 0090
    const state = await prisma.state.create({
      data: { abbreviation: 'SC', name: 'Santa Catarina' }
    });

    const muni = await prisma.municipality.create({
      data: { officialCode: '80837', name: 'Concórdia', stateId: state.id, isCoverage: true }
    });

    const zone90 = await prisma.pollingZone.create({
      data: { municipalityId: muni.id, zoneNumber: '0090', expectedBUs: 193 }
    });

    // Seção prévia 0090 (normal, elegível)
    const sec90 = await prisma.pollingSection.create({
      data: { pollingZoneId: zone90.id, sectionNumber: '0090', expectedBUs: 1 }
    });

    // Seção 0125 (comprovadamente agregada à seção 0090, expectedBUs = 0)
    const sec125 = await prisma.pollingSection.create({
      data: { pollingZoneId: zone90.id, sectionNumber: '0125', expectedBUs: 0 }
    });

    // 4. Cargo Presidente
    let presOffice = await prisma.office.findFirst({ where: { name: 'Presidente' } });
    if (!presOffice) {
      presOffice = await prisma.office.create({ data: { name: 'Presidente', orderNumber: 1 } });
    }
    presOfficeId = presOffice.id;

    // 5. Eleição e Turnos
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

    // Round 2 (inicialmente ACTIVE para testar apuração, plei 3221)
    const round2 = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 2,
        plei: '3221',
        status: 'ACTIVE'
      }
    });
    round2Id = round2.id;

    // Cobertura do Round 1 (seção 0090 com BU esperado)
    await prisma.roundCoverage.create({
      data: { electionRoundId: round1.id, pollingSectionId: sec90.id, expectedBUs: 1 }
    });

    // BU prévio do T1 já contabilizado (193 votos para candidato 13, 200 para candidato 22)
    await prisma.ballotReport.create({
      data: {
        deterministicId: '3220-1-SC-80837-0090-0090-URNA-T1-PREVIA',
        electionId: election.id,
        roundId: round1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '0090',
        sectionCode: '0090',
        urnCode: 'URNA-T1-PREVIA',
        hash: 'HASH_T1',
        status: 'PROCESSADO',
        isSimulation: false,
        votes: {
          create: [
            { officeId: presOfficeId, voteType: 'NOMINAL', candidateNumber: '13', quantity: 193 },
            { officeId: presOfficeId, voteType: 'NOMINAL', candidateNumber: '22', quantity: 200 }
          ]
        }
      }
    });

    // Metadados T1
    await prisma.candidateMetadata.createMany({
      data: [
        {
          candidateSequence: '1001',
          electionYear: 2026,
          electionCode: '6257',
          round: 1,
          state: 'BR',
          officeCode: '1',
          officeName: 'PRESIDENTE',
          candidateNumber: '13',
          ballotName: 'LULA',
          partyNumber: '13',
          partyAbbreviation: 'PT',
          partyName: 'PT'
        },
        {
          candidateSequence: '1002',
          electionYear: 2026,
          electionCode: '6257',
          round: 1,
          state: 'BR',
          officeCode: '1',
          officeName: 'PRESIDENTE',
          candidateNumber: '22',
          ballotName: 'FLÁVIO BOLSONARO',
          partyNumber: '22',
          partyAbbreviation: 'PL',
          partyName: 'PL'
        }
      ]
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
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
  });

  // -------------------------------------------------------------------------
  // 1. QRBU oficial de seção T2 já cadastrada
  // -------------------------------------------------------------------------
  it('1. Deve aceitar QRBU oficial de seção T2 previamente cadastrada no DB', async () => {
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0090 AGRE: IDUE:9900001 IDCA:990000000000000000000001 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:50',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-1-${Date.now()}`;

    // Leitura das partes
    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe('COMPLETO');
    expect(json.reportId).toBeDefined();

    // Confirmar administrativamente
    const confirmRes = await confirmRoute(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: json.reportId }) });
    expect(confirmRes.status).toBe(200);

    const report = await prisma.ballotReport.findUnique({ where: { id: json.reportId } });
    expect(report?.status).toBe('PROCESSADO');
  });

  // -------------------------------------------------------------------------
  // 2. QRBU oficial de seção T2 desconhecida, cadastrada dinamicamente
  // -------------------------------------------------------------------------
  it('2. Deve aceitar QRBU oficial de seção T2 desconhecida e cadastrá-la dinamicamente', async () => {
    // Seção 0054 NÃO existia no banco antes desta chamada
    const sectionBefore = await prisma.pollingSection.findFirst({
      where: { sectionNumber: '0054' }
    });
    expect(sectionBefore).toBeNull();

    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0054 AGRE: IDUE:9900054 IDCA:990000000000000000000054 VERS:10.20.0.0 LOCA:1 APTO:250 COMP:210 FALT:40 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:60 22:70',
      'VRQR:6.0 APTA:250 APTS:210 APTT:40 NOMI:130 BRAN:40 NULO:40 TOTC:210'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-2-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe('COMPLETO');

    // Confere que a seção foi cadastrada dinamicamente no PollingSection e no RoundCoverage
    const sectionAfter = await prisma.pollingSection.findFirst({
      where: { sectionNumber: '0054' }
    });
    expect(sectionAfter).not.toBeNull();
    expect(sectionAfter?.expectedBUs).toBe(1);

    const coverageAfter = await prisma.roundCoverage.findUnique({
      where: {
        electionRoundId_pollingSectionId: {
          electionRoundId: round2Id,
          pollingSectionId: sectionAfter!.id
        }
      }
    });
    expect(coverageAfter).not.toBeNull();
    expect(coverageAfter?.expectedBUs).toBe(1);

    // Confirma administrativamente com sucesso
    const confirmRes = await confirmRoute(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: json.reportId }) });
    expect(confirmRes.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 3. Segundo envio do mesmo BU sem duplicação de votos
  // -------------------------------------------------------------------------
  it('3. Segundo envio do mesmo BU deve retornar DUPLICADO sem duplicar votos', async () => {
    // Reenvia exatamente o mesmo BU da seção 0054
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0054 AGRE: IDUE:9900054 IDCA:990000000000000000000054 VERS:10.20.0.0 LOCA:1 APTO:250 COMP:210 FALT:40 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:60 22:70',
      'VRQR:6.0 APTA:250 APTS:210 APTT:40 NOMI:130 BRAN:40 NULO:40 TOTC:210'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-3-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.status).toBe('DUPLICADO');

    // Total de reports para essa identidade permanece exatamente 1
    const count = await prisma.ballotReport.count({
      where: { deterministicId: '3221-2-SC-80837-0090-0054-9900054' }
    });
    expect(count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 4. BU conflitante da mesma seção sem dupla contabilização
  // -------------------------------------------------------------------------
  it('4. BU conflitante da mesma seção (urna diferente) deve ser isolado como CONFLITO sem somar votos', async () => {
    // Tenta enviar BU com mesma seção 0054 mas urna diferente IDUE:9900099
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0054 AGRE: IDUE:9900099 IDCA:990000000000000000000099 VERS:10.20.0.0 LOCA:1 APTO:250 COMP:210 FALT:40 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:99 22:99',
      'VRQR:6.0 APTA:250 APTS:210 APTT:40 NOMI:198 BRAN:6 NULO:6 TOTC:210'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-4-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.status).toBe('CONFLITO');
    expect(json.error).toBe('CONFLITO_SECAO');

    // Confere que o relatório conflitante NÃO foi inserido no banco
    const conflicting = await prisma.ballotReport.findUnique({
      where: { deterministicId: '3221-2-SC-80837-0090-0054-9900099' }
    });
    expect(conflicting).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 5. QRBU do T1 rejeitado no T2
  // -------------------------------------------------------------------------
  it('5. Deve rejeitar QRBU do 1º Turno (PLEI=3220, TURN=1) quando o T2 estiver ativo', async () => {
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261004 PLEI:3220 TURN:1 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0090 AGRE: IDUE:8800001 IDCA:880000000000000000000001 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261004 HRAB:080000 DTFC:20261004 HRFC:170000 IDEL:6257 CARG:1 TIPO:0 VERC:00 13:50 22:50',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-5-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('ELECTION_CONTEXT_MISMATCH');
  });

  // -------------------------------------------------------------------------
  // 6. QRBU simulado rejeitado no modo oficial
  // -------------------------------------------------------------------------
  it('6. Deve rejeitar QRBU de simulação (FASE=S) quando escaneado no modo oficial', async () => {
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:S UNFE:SC MUNI:80837 ZONA:0090 SECA:0090 AGRE: IDUE:9900001 IDCA:990000000000000000000001 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:50',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const parts = buildQrbu(bodies, 'S');
    const sessionId = `SESSION-SCENARIO-6-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('SIMULATED_QRBU_REJECTED');
  });

  // -------------------------------------------------------------------------
  // 7. QRBU de município/zona incompatíveis rejeitado
  // -------------------------------------------------------------------------
  it('7. Deve rejeitar QRBU de município incompatível (fora de Concórdia/SC Zona 0090)', async () => {
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:81000 ZONA:0090 SECA:0001 AGRE: IDUE:9900001 IDCA:990000000000000000000001 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:50',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-7-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe('OUT_OF_COVERAGE');
  });

  // -------------------------------------------------------------------------
  // 8. Seção comprovadamente agregada não contabilizada indevidamente
  // -------------------------------------------------------------------------
  it('8. Deve rejeitar seção comprovadamente agregada sem BU independente (seção 0125)', async () => {
    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0125 AGRE: IDUE:9900125 IDCA:990000000000000000000125 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:50',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-8-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe('SECTION_AGGREGATED_NO_BU');
  });

  // -------------------------------------------------------------------------
  // 9. T2 em PLANNED não aceita apuração oficial
  // -------------------------------------------------------------------------
  it('9. T2 em estado PLANNED deve rejeitar lançamento de QRBUs oficiais', async () => {
    // Altera temporariamente T2 para PLANNED
    await prisma.electionRound.update({
      where: { id: round2Id },
      data: { status: 'PLANNED' }
    });

    const bodies = [
      'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:3221 TURN:2 FASE:O UNFE:SC MUNI:80837 ZONA:0090 SECA:0077 AGRE: IDUE:9900077 IDCA:990000000000000000000077 VERS:10.20.0.0 LOCA:1 APTO:200 COMP:180 FALT:20 HBBM:0 HBBG:0 HBSB:0 DTAB:20261025 HRAB:080000 DTFC:20261025 HRFC:170000 IDEL:6258 CARG:1 TIPO:0 VERC:00 13:50 22:50',
      'VRQR:6.0 APTA:200 APTS:180 APTT:20 NOMI:100 BRAN:40 NULO:40 TOTC:180'
    ];
    const parts = buildQrbu(bodies, 'O');
    const sessionId = `SESSION-SCENARIO-9-${Date.now()}`;

    await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[0], sessionId, isSimulation: false })
    }));

    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content: parts[1], sessionId, isSimulation: false })
    }));

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('ELECTION_CONTEXT_MISMATCH');

    // Restaura T2 para ACTIVE
    await prisma.electionRound.update({
      where: { id: round2Id },
      data: { status: 'ACTIVE' }
    });
  });

  // -------------------------------------------------------------------------
  // 10. Totalizações do T1 permanecem inalteradas
  // -------------------------------------------------------------------------
  it('10. Totalizações do T1 devem permanecer estritamente inalteradas e íntegras', async () => {
    const res = await totalsRoute(new Request('http://localhost/api/totals?round=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.round.roundNumber).toBe(1);
    expect(json.coverageConfigured).toBe(true);
    expect(json.coverageStatus).toBe('CONFIRMADA');
    expect(json.isProvisional).toBe(false);
    expect(json.processedReports).toBe(1);

    const lula = json.totals.find((t: any) => t.candidateNumber === '13');
    const flavio = json.totals.find((t: any) => t.candidateNumber === '22');

    expect(lula?.quantity).toBe(193);
    expect(lula?.candidateName).toBe('LULA');
    expect(flavio?.quantity).toBe(200);
    expect(flavio?.candidateName).toBe('FLÁVIO BOLSONARO');
  });

  // -------------------------------------------------------------------------
  // Verificação de Cobertura Provisória no T2
  // -------------------------------------------------------------------------
  it('11. /api/totals?round=2 deve retornar cobertura provisória com votos contabilizados', async () => {
    const res = await totalsRoute(new Request('http://localhost/api/totals?round=2'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.round.roundNumber).toBe(2);
    expect(json.coverageConfigured).toBe(false);
    expect(json.coverageStatus).toBe('PROVISORIA');
    expect(json.isProvisional).toBe(true);
    expect(json.expectedReports).toBe(0);
    expect(json.officialExpectedReports).toBeNull();
    // 2 BUs foram confirmados no T2 (seção 0090 e seção 0054 dinâmica)
    expect(json.processedReports).toBe(2);
    expect(json.dynamicallyRegisteredSections).toBe(2);

    // Votos do T2 somados
    const vote13 = json.totals.find((t: any) => t.candidateNumber === '13');
    const vote22 = json.totals.find((t: any) => t.candidateNumber === '22');

    // 50 (seção 0090) + 60 (seção 0054) = 110
    expect(vote13?.quantity).toBe(110);
    // 50 (seção 0090) + 70 (seção 0054) = 120
    expect(vote22?.quantity).toBe(120);
  });
});

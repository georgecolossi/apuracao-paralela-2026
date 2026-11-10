import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { generateCsrfToken } from '../src/lib/security/csrf';
import { POST as scanPost } from '../src/app/api/scan/route';
import { POST as confirmPost } from '../src/app/api/reports/[id]/confirm/route';
import { GET as totalsGet } from '../src/app/api/totals/route';
import { GET as urnasGet } from '../src/app/api/urnas/route';
import { validateScanSessionCompatibility } from '../src/lib/scanner/sessionValidator';

function buildTwoPartSyntheticPhaseO(seqTag: string) {
  const bodyPart1 =
    `VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:2202 TURN:2 FASE:O UNFE:AC MUNI:1392 ZONA:9 SECA:13 AGRE:14.15 IDUE:${seqTag} IDCA:146113540341669047216787 HIQT:2 HICA:1:146113540341669047216787 VERS:10.20.0.0 LOCA:15 APTO:26 APTS:26 APTT:0 COMP:4 FALT:22 HBBM:3 HBBG:1 HBSB:0 DTAB:20261025 HRAB:171506 DTFC:20261025 HRFC:171951`;
  const bodyPart2Unsigned = `VRQR:6.0 IDEL:2212 CARG:1 TIPO:0 VERC:202608131512 92:2 APTA:26 APTS:26 APTT:0 NOMI:2 BRAN:1 NULO:1 TOTC:4`;

  const hashInput = [
    bodyPart1.replace(/^VRQR:\S+ /, ''),
    bodyPart2Unsigned.replace(/^VRQR:\S+ /, '')
  ].join(' ');
  const sha512 = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();

  return {
    part1Of2: `QRBU:1:2 ${bodyPart1}`,
    part2Of2: `QRBU:2:2 ${bodyPart2Unsigned} HASH:${sha512}`,
    part2Of3Mismatch: `QRBU:2:3 ${bodyPart2Unsigned} HASH:${sha512}`
  };
}

describe('P2 — Integridade de ScanSession em POST /api/scan', () => {
  let opA: { id: string; role: string; sessionVersion: number };
  let opB: { id: string; role: string; sessionVersion: number };
  let simRoundId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-scan-session-integrity-secret-32chars';
    delete process.env.ALLOW_SIMULATED_FASE;

    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.roundCoverage.deleteMany({});
    await prisma.tseSyncConfig.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.office.deleteMany({});
    await prisma.party.deleteMany({});
    await prisma.electionScope.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});
    await prisma.pollingSection.deleteMany({});
    await prisma.pollingZone.deleteMany({});
    await prisma.auditLog.deleteMany({});

    const stateAC = await prisma.state.upsert({
      where: { abbreviation: 'AC' },
      update: {},
      create: { abbreviation: 'AC', name: 'Acre' }
    });
    const muniAC = await prisma.municipality.upsert({
      where: { officialCode: '01392' },
      update: { name: 'Rio Branco', isCoverage: true },
      create: { officialCode: '01392', name: 'Rio Branco', stateId: stateAC.id, isCoverage: true }
    });
    const zone9 = await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniAC.id, zoneNumber: '0009' } },
      update: {},
      create: { municipalityId: muniAC.id, zoneNumber: '0009' }
    });
    const sec13 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zone9.id, sectionNumber: '0013' } },
      update: { expectedBUs: 1 },
      create: { pollingZoneId: zone9.id, sectionNumber: '0013', expectedBUs: 1 }
    });

    const simElection = await prisma.election.create({
      data: {
        name: 'Eleição Simulação Sessão Teste',
        slug: `sim-session-test-${Date.now()}`,
        plei: 'SIM-2202',
        year: 2026,
        type: 'GENERAL',
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 1, plei: 'SIM-2202', status: 'ACTIVE' }] },
        offices: { create: [{ code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }] }
      },
      include: { rounds: true }
    });
    simRoundId = simElection.rounds[0].id;

    await prisma.roundCoverage.create({
      data: {
        electionRoundId: simRoundId,
        pollingSectionId: sec13.id,
        expectedBUs: 1
      }
    });

    opA = await prisma.user.create({
      data: {
        name: 'Operador A',
        email: `op-a-sess-${Date.now()}@test.local`,
        passwordHash: 'hash-a',
        role: 'OPERATOR',
        isActive: true,
        sessionVersion: 1
      }
    });

    opB = await prisma.user.create({
      data: {
        name: 'Operador B',
        email: `op-b-sess-${Date.now()}@test.local`,
        passwordHash: 'hash-b',
        role: 'OPERATOR',
        isActive: true,
        sessionVersion: 1
      }
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.roundCoverage.deleteMany({});
    await prisma.tseSyncConfig.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.office.deleteMany({});
    await prisma.party.deleteMany({});
    await prisma.electionScope.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});
    await prisma.pollingSection.deleteMany({});
    await prisma.pollingZone.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { in: [opA.id, opB.id] } } });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockAuthAs(user: { id: string; role: string; sessionVersion: number }) {
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: {
        userId: user.id,
        role: user.role,
        sessionVersion: user.sessionVersion
      }
    } as never);
  }

  function makeScanRequest(
    user: { id: string; sessionVersion: number },
    body: Record<string, unknown>
  ) {
    const csrf = generateCsrfToken(user.id, user.sessionVersion);
    return new Request('http://localhost/api/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Host: 'localhost',
        'x-csrf-token': csrf
      },
      body: JSON.stringify(body)
    });
  }

  it('Validador unitário de compatibilidade de ScanSession cobre modo, operador e partes', () => {
    expect(
      validateScanSessionCompatibility(
        { isSimulation: false, expectedParts: 2, operatorId: 'op-1' },
        { isSimulation: true, totalParts: 2, operatorId: 'op-1' }
      )
    ).toMatchObject({ valid: false, status: 409, code: 'SCAN_SESSION_MODE_MISMATCH' });

    expect(
      validateScanSessionCompatibility(
        { isSimulation: true, expectedParts: 2, operatorId: 'op-1' },
        { isSimulation: true, totalParts: 2, operatorId: 'op-2' }
      )
    ).toMatchObject({ valid: false, status: 403, code: 'SCAN_SESSION_OPERATOR_MISMATCH' });

    expect(
      validateScanSessionCompatibility(
        { isSimulation: false, expectedParts: 2, operatorId: 'op-1' },
        { isSimulation: false, totalParts: 3, operatorId: 'op-1' }
      )
    ).toMatchObject({ valid: false, status: 409, code: 'SCAN_SESSION_PARTS_MISMATCH' });

    expect(
      validateScanSessionCompatibility(
        { isSimulation: false, expectedParts: 2, operatorId: 'op-1' },
        { isSimulation: false, totalParts: 2, operatorId: 'op-1' }
      )
    ).toEqual({ valid: true });
  });

  it('1. Sessão iniciada como real (isSimulation=false) rejeita requisição simulada (isSimulation=true) sem mutações', async () => {
    const sequenceId = `SESS-REAL-TO-SIM-${Date.now()}`;
    const qr = buildTwoPartSyntheticPhaseO('9100001');

    mockAuthAs(opA);
    const res1 = await scanPost(
      makeScanRequest(opA, {
        content: qr.part1Of2,
        isSimulation: false,
        sessionId: sequenceId
      })
    );
    expect(res1.status).toBe(200);
    expect((await res1.json()).status).toBe('PARCIAL');

    const reportsBefore = await prisma.ballotReport.count();

    mockAuthAs(opA);
    const res2 = await scanPost(
      makeScanRequest(opA, {
        content: `SIMULATION|2|2|${sequenceId}|`,
        isSimulation: true,
        sessionId: sequenceId
      })
    );
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe('SCAN_SESSION_MODE_MISMATCH');

    const sessionInDb = await prisma.scanSession.findUnique({ where: { sequenceId } });
    expect(sessionInDb).not.toBeNull();
    expect(sessionInDb?.isSimulation).toBe(false);
    expect(sessionInDb?.status).toBe('ACTIVE');
    expect(sessionInDb?.expectedParts).toBe(2);

    const parts = await prisma.ballotReportPart.findMany({ where: { sessionId: sessionInDb!.id } });
    expect(parts).toHaveLength(1);
    expect(await prisma.ballotReport.count()).toBe(reportsBefore);
  });

  it('2. Sessão iniciada como simulada (isSimulation=true) rejeita requisição real (isSimulation=false) sem mutações', async () => {
    const sequenceId = `SESS-SIM-TO-REAL-${Date.now()}`;
    const qr = buildTwoPartSyntheticPhaseO('9100002');

    mockAuthAs(opA);
    const res1 = await scanPost(
      makeScanRequest(opA, {
        content: `SIMULATION|1|2|${sequenceId}|2202|1|AC|01392|9|13|9100002|Presidente,13,13,NOMINAL,10|h1|s1`,
        isSimulation: true,
        sessionId: sequenceId
      })
    );
    expect(res1.status).toBe(200);
    expect((await res1.json()).status).toBe('PARCIAL');

    const reportsBefore = await prisma.ballotReport.count();

    mockAuthAs(opA);
    const res2 = await scanPost(
      makeScanRequest(opA, {
        content: qr.part2Of2,
        isSimulation: false,
        sessionId: sequenceId
      })
    );
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe('SCAN_SESSION_MODE_MISMATCH');

    const sessionInDb = await prisma.scanSession.findUnique({ where: { sequenceId } });
    expect(sessionInDb?.isSimulation).toBe(true);
    expect(sessionInDb?.status).toBe('ACTIVE');
    expect(sessionInDb?.expectedParts).toBe(2);

    const parts = await prisma.ballotReportPart.findMany({ where: { sessionId: sessionInDb!.id } });
    expect(parts).toHaveLength(1);
    expect(await prisma.ballotReport.count()).toBe(reportsBefore);
  });

  it('3. Reutilização com totalParts divergente é rejeitada sem inserir parte nem alterar sessão', async () => {
    const sequenceId = `SESS-PARTS-MISMATCH-${Date.now()}`;
    const qr = buildTwoPartSyntheticPhaseO('9100003');

    mockAuthAs(opA);
    const res1 = await scanPost(
      makeScanRequest(opA, {
        content: qr.part1Of2,
        isSimulation: false,
        sessionId: sequenceId
      })
    );
    expect(res1.status).toBe(200);

    const reportsBefore = await prisma.ballotReport.count();

    mockAuthAs(opA);
    const res2 = await scanPost(
      makeScanRequest(opA, {
        content: qr.part2Of3Mismatch,
        isSimulation: false,
        sessionId: sequenceId
      })
    );
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe('SCAN_SESSION_PARTS_MISMATCH');

    const sessionInDb = await prisma.scanSession.findUnique({ where: { sequenceId } });
    expect(sessionInDb?.expectedParts).toBe(2);
    expect(sessionInDb?.status).toBe('ACTIVE');
    expect(await prisma.ballotReportPart.count({ where: { sessionId: sessionInDb!.id } })).toBe(1);
    expect(await prisma.ballotReport.count()).toBe(reportsBefore);
  });

  it('4. Reutilização por operador autenticado diferente é rejeitada (403) sem mutações e sem bloquear operador original', async () => {
    const sequenceId = `SESS-OP-MISMATCH-${Date.now()}`;

    mockAuthAs(opA);
    const res1 = await scanPost(
      makeScanRequest(opA, {
        content: `SIMULATION|1|2|${sequenceId}|2202|1|AC|01392|9|13|9100004|Presidente,13,13,NOMINAL,15|h4|s4`,
        isSimulation: true,
        sessionId: sequenceId
      })
    );
    expect(res1.status).toBe(200);

    const reportsBefore = await prisma.ballotReport.count();

    // Operador B tenta reutilizar a sessão de Operador A
    mockAuthAs(opB);
    const resHijack = await scanPost(
      makeScanRequest(opB, {
        content: `SIMULATION|2|2|${sequenceId}|`,
        isSimulation: true,
        sessionId: sequenceId
      })
    );
    expect(resHijack.status).toBe(403);
    expect((await resHijack.json()).error).toBe('SCAN_SESSION_OPERATOR_MISMATCH');

    const sessionMid = await prisma.scanSession.findUnique({ where: { sequenceId } });
    expect(sessionMid?.operatorId).toBe(opA.id);
    expect(sessionMid?.status).toBe('ACTIVE');
    expect(await prisma.ballotReportPart.count({ where: { sessionId: sessionMid!.id } })).toBe(1);
    expect(await prisma.ballotReport.count()).toBe(reportsBefore);

    // Operador A legítimo ainda conclui a simulação normalmente e ela permanece isolada de /api/totals e /api/urnas
    mockAuthAs(opA);
    const res2 = await scanPost(
      makeScanRequest(opA, {
        content: `SIMULATION|2|2|${sequenceId}|`,
        isSimulation: true,
        sessionId: sequenceId
      })
    );
    expect(res2.status).toBe(200);
    const completedJson = await res2.json();
    expect(completedJson.status).toBe('COMPLETO');
    expect(completedJson.reportId).toBeTruthy();

    mockAuthAs({ ...opA, role: 'ADMIN' });
    const confRes = await confirmPost(
      new Request(`http://localhost/api/reports/${completedJson.reportId}/confirm`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Host: 'localhost',
          'x-csrf-token': generateCsrfToken(opA.id, opA.sessionVersion)
        }
      }),
      { params: Promise.resolve({ id: completedJson.reportId }) }
    );
    expect(confRes.status).toBe(200);

    const persistedReport = await prisma.ballotReport.findUnique({ where: { id: completedJson.reportId } });
    expect(persistedReport?.isSimulation).toBe(true);
    expect(persistedReport?.status).toBe('PROCESSADO');

    const totalsRes = await totalsGet(new Request('http://localhost/api/totals?round=1'));
    expect(totalsRes.status).toBe(200);
    expect((await totalsRes.json()).totals).toHaveLength(0);

    const urnasRes = await urnasGet(new Request('http://localhost/api/urnas?round=1'));
    expect(urnasRes.status).toBe(200);
    expect((await urnasRes.json()).items).toHaveLength(0);
  });
});

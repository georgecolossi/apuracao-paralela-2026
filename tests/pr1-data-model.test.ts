import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

describe('PR 1 — Universal Data Model & Entity Abstraction', () => {
  const testRunId = Date.now().toString();

  beforeAll(async () => {
    // Garante que o ambiente de teste esteja limpo para este conjunto
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Elimina a colisão global: candidatos com mesmo número em cargos diferentes coexistem', async () => {
    const election = await prisma.election.create({
      data: {
        slug: `eleicao-multi-cargo-${testRunId}`,
        name: 'Eleição Teste Multi-Cargo',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    const officePres = await prisma.office.create({
      data: {
        electionId: election.id,
        code: '1',
        name: 'Presidente',
        orderNumber: 1
      }
    });

    const officeGov = await prisma.office.create({
      data: {
        electionId: election.id,
        code: '3',
        name: 'Governador',
        orderNumber: 2
      }
    });

    const party13 = await prisma.party.create({
      data: {
        officialIdentifier: `13-${testRunId}`,
        name: 'Partido dos Trabalhadores',
        abbreviation: 'PT'
      }
    });

    const party22 = await prisma.party.create({
      data: {
        officialIdentifier: `22-${testRunId}`,
        name: 'Partido Liberal',
        abbreviation: 'PL'
      }
    });

    // Cria candidato 13 para Presidente
    const candPres13 = await prisma.candidate.create({
      data: {
        officeId: officePres.id,
        partyId: party13.id,
        candidateNumber: '13',
        name: 'Candidato Pres 13',
        ballotName: 'Lula'
      }
    });

    // Cria candidato 13 para Governador (MESMO NÚMERO, CARGO DIFERENTE - NÃO DEVE COLIDIR!)
    const candGov13 = await prisma.candidate.create({
      data: {
        officeId: officeGov.id,
        partyId: party13.id,
        candidateNumber: '13',
        name: 'Candidato Gov 13',
        ballotName: 'Décio'
      }
    });

    // Cria candidato 22 para Presidente e Governador
    const candPres22 = await prisma.candidate.create({
      data: {
        officeId: officePres.id,
        partyId: party22.id,
        candidateNumber: '22',
        name: 'Candidato Pres 22',
        ballotName: 'Bolsonaro'
      }
    });

    const candGov22 = await prisma.candidate.create({
      data: {
        officeId: officeGov.id,
        partyId: party22.id,
        candidateNumber: '22',
        name: 'Candidato Gov 22',
        ballotName: 'Jorginho'
      }
    });

    expect(candPres13.id).not.toBe(candGov13.id);
    expect(candPres13.candidateNumber).toBe('13');
    expect(candGov13.candidateNumber).toBe('13');
    expect(candPres22.candidateNumber).toBe('22');
    expect(candGov22.candidateNumber).toBe('22');

    // Teste negativo: Tentar duplicar o número 13 NO MESMO CARGO deve lançar erro P2002
    await expect(
      prisma.candidate.create({
        data: {
          officeId: officePres.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Duplicata Invalida',
          ballotName: 'Outro 13'
        }
      })
    ).rejects.toThrow();
  });

  it('2. Isolamento contextual entre eleições distintas: códigos e turnos podem repetir', async () => {
    const electionA = await prisma.election.create({
      data: {
        slug: `eleicao-a-${testRunId}`,
        name: 'Eleição Geral 2026',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    const electionB = await prisma.election.create({
      data: {
        slug: `eleicao-b-${testRunId}`,
        name: 'Eleição Suplementar 2027',
        year: 2027,
        status: 'DRAFT'
      }
    });

    // Turno 1 na Eleição A e Turno 1 na Eleição B coexistem sem colisão
    const roundA1 = await prisma.electionRound.create({
      data: { electionId: electionA.id, roundNumber: 1, status: 'ACTIVE', plei: '6257' }
    });

    const roundB1 = await prisma.electionRound.create({
      data: { electionId: electionB.id, roundNumber: 1, status: 'PLANNED', plei: '7001' }
    });

    expect(roundA1.roundNumber).toBe(1);
    expect(roundB1.roundNumber).toBe(1);
    expect(roundA1.electionId).toBe(electionA.id);
    expect(roundB1.electionId).toBe(electionB.id);

    // Tentativa de duplicar o roundNumber 1 DENTRO DA MESMA eleição deve ser rejeitada
    await expect(
      prisma.electionRound.create({
        data: { electionId: electionA.id, roundNumber: 1, status: 'PLANNED' }
      })
    ).rejects.toThrow();

    // Cargo '1' (Presidente) pode existir em ambas as eleições com o mesmo código '1'
    const officeA = await prisma.office.create({
      data: { electionId: electionA.id, code: '1', name: 'Presidente', orderNumber: 1 }
    });

    const officeB = await prisma.office.create({
      data: { electionId: electionB.id, code: '1', name: 'Presidente', orderNumber: 1 }
    });

    expect(officeA.code).toBe('1');
    expect(officeB.code).toBe('1');
    expect(officeA.electionId).not.toBe(officeB.electionId);

    // Tentativa de duplicar o código '1' na MESMA eleição deve falhar
    await expect(
      prisma.office.create({
        data: { electionId: electionA.id, code: '1', name: 'Presidente Duplicado', orderNumber: 9 }
      })
    ).rejects.toThrow();
  });

  it('3. Abrangência geográfica (ElectionScope): Nacional, Estadual e Municipal com unicidade estrita', async () => {
    const election = await prisma.election.create({
      data: {
        slug: `eleicao-scopes-${testRunId}`,
        name: 'Eleição Escopos',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    const stateSC = await prisma.state.upsert({
      where: { abbreviation: 'SC' },
      update: {},
      create: { name: 'Santa Catarina', abbreviation: 'SC' }
    });

    const muniConcordia = await prisma.municipality.upsert({
      where: { officialCode: '80837' },
      update: {},
      create: { name: 'Concórdia', officialCode: '80837', stateId: stateSC.id }
    });

    // 1. Escopo Nacional
    const scopeBR = await prisma.electionScope.create({
      data: {
        electionId: election.id,
        scopeType: 'NACIONAL',
        scopeKey: 'BR',
        isCoverageArea: true
      }
    });

    // 2. Escopo Estadual
    const scopeSC = await prisma.electionScope.create({
      data: {
        electionId: election.id,
        scopeType: 'ESTADUAL',
        scopeKey: 'UF:SC',
        stateId: stateSC.id,
        isCoverageArea: true
      }
    });

    // 3. Escopo Municipal
    const scopeMun = await prisma.electionScope.create({
      data: {
        electionId: election.id,
        scopeType: 'MUNICIPAL',
        scopeKey: 'MUN:80837',
        stateId: stateSC.id,
        municipalityId: muniConcordia.id,
        isCoverageArea: true
      }
    });

    expect(scopeBR.scopeKey).toBe('BR');
    expect(scopeSC.scopeKey).toBe('UF:SC');
    expect(scopeMun.scopeKey).toBe('MUN:80837');

    // Tentativa de inserir escopo duplicado com mesma scopeKey deve falhar
    await expect(
      prisma.electionScope.create({
        data: {
          electionId: election.id,
          scopeType: 'NACIONAL',
          scopeKey: 'BR'
        }
      })
    ).rejects.toThrow();
  });

  it('4. Homologação formal de cobertura com metadados auditáveis', async () => {
    const election = await prisma.election.create({
      data: {
        slug: `eleicao-homologacao-${testRunId}`,
        name: 'Eleição com Homologação',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    const round = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 1,
        status: 'PLANNED',
        coverageStatus: 'PROVISIONAL'
      }
    });

    expect(round.coverageStatus).toBe('PROVISIONAL');
    expect(round.coverageHomologatedAt).toBeNull();

    // Transição para REGISTERED (quando seções são importadas/cadastradas)
    const registeredRound = await prisma.electionRound.update({
      where: { id: round.id },
      data: {
        coverageStatus: 'REGISTERED',
        coverageOrigin: 'TSE_EA16_IMPORT'
      }
    });
    expect(registeredRound.coverageStatus).toBe('REGISTERED');
    expect(registeredRound.coverageOrigin).toBe('TSE_EA16_IMPORT');

    // Homologação formal com metadados de evidência
    const now = new Date();
    const homologatedRound = await prisma.electionRound.update({
      where: { id: round.id },
      data: {
        coverageStatus: 'HOMOLOGATED',
        coverageHomologatedAt: now,
        coverageHomologatedBy: 'admin-auditor-1',
        coverageHomologationType: 'TSE_OFFICIAL_CONFIRMATION',
        coverageEvidenceNotes: 'Checksum EA16 validado contra catálogo oficial TSE 2026. 193 urnas confirmadas.'
      }
    });

    expect(homologatedRound.coverageStatus).toBe('HOMOLOGATED');
    expect(homologatedRound.coverageHomologatedBy).toBe('admin-auditor-1');
    expect(homologatedRound.coverageHomologationType).toBe('TSE_OFFICIAL_CONFIRMATION');
    expect(homologatedRound.coverageEvidenceNotes).toContain('193 urnas confirmadas');
  });

  it('5. TseSyncConfig dinâmico permite múltiplos cargos e âmbitos sem colisão', async () => {
    const election = await prisma.election.create({
      data: {
        slug: `eleicao-tse-configs-${testRunId}`,
        name: 'Eleição TSE Múltiplos Configs',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    // Config 1: Presidente (Federal/Nacional)
    const configPres = await prisma.tseSyncConfig.create({
      data: {
        electionId: election.id,
        roundNumber: 2,
        officeCode: '1',
        officialElectionCode: '6258',
        scopeType: 'NACIONAL',
        uf: 'BR',
        syncIntervalSeconds: 15
      }
    });

    // Config 2: Governador (Estadual SC)
    const configGov = await prisma.tseSyncConfig.create({
      data: {
        electionId: election.id,
        roundNumber: 2,
        officeCode: '3',
        officialElectionCode: '6259',
        scopeType: 'ESTADUAL',
        uf: 'SC',
        syncIntervalSeconds: 20
      }
    });

    // Config 3: Prefeito (Municipal Concórdia)
    const configPref = await prisma.tseSyncConfig.create({
      data: {
        electionId: election.id,
        roundNumber: 2,
        officeCode: '11',
        officialElectionCode: '6260',
        scopeType: 'MUNICIPAL',
        uf: 'SC',
        muniTseCode: '80837',
        syncIntervalSeconds: 30
      }
    });

    const configs = await prisma.tseSyncConfig.findMany({
      where: { electionId: election.id, roundNumber: 2 }
    });

    expect(configs).toHaveLength(3);
    expect(configs.map(c => c.officeCode)).toEqual(expect.arrayContaining(['1', '3', '11']));
  });

  it('6. Ciclo de vida dos Boletins de Urna: inicia em RECEBIDO e contabiliza após PROCESSADO', async () => {
    const election = await prisma.election.create({
      data: {
        slug: `eleicao-bu-lifecycle-${testRunId}`,
        name: 'Eleição Ciclo BU',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    const round = await prisma.electionRound.create({
      data: { electionId: election.id, roundNumber: 1, status: 'ACTIVE' }
    });

    const report = await prisma.ballotReport.create({
      data: {
        deterministicId: `DET-LIFECYCLE-${testRunId}`,
        electionId: election.id,
        roundId: round.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '0009',
        sectionCode: '0015',
        urnCode: '12345678'
        // status omitido para testar valor padrão
      }
    });

    // Padrão obrigatório: RECEBIDO (não PROCESSADO!)
    expect(report.status).toBe('RECEBIDO');

    // Transição para PENDENTE_CONFIRMACAO
    const pending = await prisma.ballotReport.update({
      where: { id: report.id },
      data: { status: 'PENDENTE_CONFIRMACAO' }
    });
    expect(pending.status).toBe('PENDENTE_CONFIRMACAO');

    // Transição final para PROCESSADO
    const processed = await prisma.ballotReport.update({
      where: { id: report.id },
      data: { status: 'PROCESSADO', confirmedAt: new Date() }
    });
    expect(processed.status).toBe('PROCESSADO');
    expect(processed.confirmedAt).not.toBeNull();
  });

  it('7. Relações inversas e operadores não-órfãos em sessões multipartes', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Operador de Testes',
        email: `operador-${testRunId}@apuracao.local`,
        passwordHash: 'hash',
        role: 'OPERATOR'
      }
    });

    const session = await prisma.scanSession.create({
      data: {
        sequenceId: `seq-multi-${testRunId}`,
        operatorId: user.id,
        expectedParts: 2,
        status: 'ACTIVE'
      }
    });

    const part1 = await prisma.ballotReportPart.create({
      data: {
        sessionId: session.id,
        partIndex: 1,
        totalParts: 2,
        rawContent: 'QRBU:1:2 content part 1',
        contentHash: 'hash1',
        operatorId: user.id
      }
    });

    // Consulta usuário incluindo relações inversas
    const userWithRelations = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        scanSessions: true,
        reportParts: true
      }
    });

    expect(userWithRelations?.scanSessions).toHaveLength(1);
    expect(userWithRelations?.scanSessions[0].id).toBe(session.id);
    expect(userWithRelations?.reportParts).toHaveLength(1);
    expect(userWithRelations?.reportParts[0].id).toBe(part1.id);
  });
});

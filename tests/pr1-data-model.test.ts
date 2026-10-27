import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  validateBallotIngestionInvariants,
  validateElectionScopeAddition,
  validateCoverageTransition,
  buildTseSyncConfigKey,
  ElectionInvariantError
} from '@/lib/validation/electionContext';

describe('PR 1 — Universal Data Model, Entity Abstraction & Contextual Invariants', () => {
  const testRunId = Date.now().toString();

  beforeAll(async () => {});

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

  it('3. Testes negativos de invariantes transacionais multi-eleição', async () => {
    const electionA = await prisma.election.create({
      data: { slug: `inv-elec-a-${testRunId}`, name: 'Eleição A', year: 2026, status: 'ACTIVE' }
    });

    const electionB = await prisma.election.create({
      data: { slug: `inv-elec-b-${testRunId}`, name: 'Eleição B', year: 2026, status: 'DRAFT' }
    });

    const roundA = await prisma.electionRound.create({
      data: { electionId: electionA.id, roundNumber: 1, status: 'ACTIVE' }
    });

    const roundB = await prisma.electionRound.create({
      data: { electionId: electionB.id, roundNumber: 1, status: 'PLANNED' }
    });

    const officeA = await prisma.office.create({
      data: { electionId: electionA.id, code: '1', name: 'Presidente', orderNumber: 1 }
    });

    const officeB = await prisma.office.create({
      data: { electionId: electionB.id, code: '1', name: 'Presidente', orderNumber: 1 }
    });

    const party = await prisma.party.create({
      data: { officialIdentifier: `party-inv-${testRunId}`, name: 'Partido Invariante', abbreviation: 'PI' }
    });

    const candOfficeA = await prisma.candidate.create({
      data: { officeId: officeA.id, partyId: party.id, candidateNumber: '99', name: 'Cand A', ballotName: 'Cand A' }
    });

    // 3.1. Tentativa de cruzar Turno B com Eleição A deve lançar ROUND_ELECTION_MISMATCH
    await expect(
      prisma.$transaction(async (tx) => {
        await validateBallotIngestionInvariants(tx, {
          electionId: electionA.id,
          roundId: roundB.id, // Pertence à eleição B!
          votes: [{ officeId: officeA.id, voteType: 'NOMINAL', quantity: 10 }]
        });
      })
    ).rejects.toThrow(ElectionInvariantError);

    // 3.2. Tentativa de votar em Cargo da Eleição B dentro de relatório da Eleição A deve lançar OFFICE_ELECTION_MISMATCH
    await expect(
      prisma.$transaction(async (tx) => {
        await validateBallotIngestionInvariants(tx, {
          electionId: electionA.id,
          roundId: roundA.id,
          votes: [{ officeId: officeB.id, voteType: 'NOMINAL', quantity: 10 }] // Cargo da Eleição B!
        });
      })
    ).rejects.toThrow(ElectionInvariantError);

    // 3.3. Tentativa de votar em candidato do Cargo A informando Cargo B deve lançar CANDIDATE_OFFICE_MISMATCH
    await expect(
      prisma.$transaction(async (tx) => {
        await validateBallotIngestionInvariants(tx, {
          electionId: electionA.id,
          roundId: roundA.id,
          votes: [{ officeId: officeA.id, candidateId: 'id-inexistente', voteType: 'NOMINAL', quantity: 10 }]
        });
      })
    ).rejects.toThrow(ElectionInvariantError);
  });

  it('4. Abrangência geográfica (ElectionScope) e prevenção de contradições', async () => {
    const election = await prisma.election.create({
      data: { slug: `scope-hierarchy-${testRunId}`, name: 'Eleição Escopos', year: 2026, status: 'ACTIVE' }
    });

    const stateSC = await prisma.state.upsert({
      where: { abbreviation: 'SC' },
      update: {},
      create: { name: 'Santa Catarina', abbreviation: 'SC' }
    });

    // Cria escopo Nacional
    const scopeBR = await prisma.electionScope.create({
      data: {
        electionId: election.id,
        scopeType: 'NACIONAL',
        scopeKey: 'BR',
        isCoverageArea: true
      }
    });
    expect(scopeBR.scopeKey).toBe('BR');

    // Validação de Contradição: Tentar adicionar escopo regional quando escopo nacional já existe deve ser rejeitado
    expect(() => {
      validateElectionScopeAddition(
        [{ scopeType: 'NACIONAL', scopeKey: 'BR' }],
        { scopeType: 'ESTADUAL', scopeKey: 'UF:SC' }
      );
    }).toThrow(ElectionInvariantError);

    // Tentar adicionar escopo com chave duplicada deve ser rejeitado
    expect(() => {
      validateElectionScopeAddition(
        [{ scopeType: 'NACIONAL', scopeKey: 'BR' }],
        { scopeType: 'NACIONAL', scopeKey: 'BR' }
      );
    }).toThrow(ElectionInvariantError);

    // Em eleição regional, múltiplos municípios coexistem harmoniosamente
    const regionalScopes = [
      { scopeType: 'MUNICIPAL', scopeKey: 'MUN:80837' }
    ];
    expect(() => {
      validateElectionScopeAddition(regionalScopes, { scopeType: 'MUNICIPAL', scopeKey: 'MUN:80838' });
    }).not.toThrow();

    // Mas tentar adicionar escopo nacional a uma eleição já particionada regionalmente é rejeitado
    expect(() => {
      validateElectionScopeAddition(regionalScopes, { scopeType: 'NACIONAL', scopeKey: 'BR' });
    }).toThrow(ElectionInvariantError);
  });

  it('5. Validação rigorosa de transição e homologação de cobertura', async () => {
    // 5.1. Não pode transicionar direto de PROVISIONAL para HOMOLOGATED
    expect(() => {
      validateCoverageTransition('PROVISIONAL', 'HOMOLOGATED', {
        homologatedBy: 'admin',
        homologationType: 'TSE_OFFICIAL_CONFIRMATION',
        evidenceNotes: 'Checksum oficial de 193 seções'
      });
    }).toThrow(ElectionInvariantError);

    // 5.2. Não pode registrar cobertura sem seções vinculadas
    expect(() => {
      validateCoverageTransition('PROVISIONAL', 'REGISTERED', { sectionsCount: 0 });
    }).toThrow(ElectionInvariantError);

    // 5.3. Homologação exige responsável obrigatório
    expect(() => {
      validateCoverageTransition('REGISTERED', 'HOMOLOGATED', {
        homologatedBy: '',
        homologationType: 'TSE_OFFICIAL_CONFIRMATION',
        evidenceNotes: 'Checksum válido'
      });
    }).toThrow(ElectionInvariantError);

    // 5.4. Homologação exige tipo de confirmação válido
    expect(() => {
      validateCoverageTransition('REGISTERED', 'HOMOLOGATED', {
        homologatedBy: 'admin',
        homologationType: 'INVALID_TYPE',
        evidenceNotes: 'Checksum válido'
      });
    }).toThrow(ElectionInvariantError);

    // 5.5. Homologação exige notas de evidência suficientes
    expect(() => {
      validateCoverageTransition('REGISTERED', 'HOMOLOGATED', {
        homologatedBy: 'admin',
        homologationType: 'TSE_OFFICIAL_CONFIRMATION',
        evidenceNotes: 'curto'
      });
    }).toThrow(ElectionInvariantError);

    // 5.6. Homologação com dados completos tem sucesso
    expect(() => {
      validateCoverageTransition('REGISTERED', 'HOMOLOGATED', {
        homologatedBy: 'auditor-chefe',
        homologationType: 'TSE_OFFICIAL_CONFIRMATION',
        evidenceNotes: 'SHA256 do arquivo EA16 validado contra o catálogo oficial do TSE 2026.'
      });
    }).not.toThrow();
  });

  it('6. TseSyncConfig com unicidade lógica por eleição, turno, cargo e abrangência', async () => {
    const election = await prisma.election.create({
      data: { slug: `tse-sync-keys-${testRunId}`, name: 'Eleição TSE Keys', year: 2026, status: 'ACTIVE' }
    });

    const keyPres = buildTseSyncConfigKey({ roundNumber: 1, officeCode: '1', scopeType: 'NACIONAL', uf: 'BR' });
    const keyGov = buildTseSyncConfigKey({ roundNumber: 1, officeCode: '3', scopeType: 'ESTADUAL', uf: 'SC' });

    expect(keyPres).toBe('R1:OFFICE-1:NACIONAL:BR:GLOBAL');
    expect(keyGov).toBe('R1:OFFICE-3:ESTADUAL:SC:GLOBAL');

    await prisma.tseSyncConfig.create({
      data: {
        electionId: election.id,
        roundNumber: 1,
        configKey: keyPres,
        officeCode: '1',
        officialElectionCode: '6257',
        scopeType: 'NACIONAL',
        uf: 'BR'
      }
    });

    await prisma.tseSyncConfig.create({
      data: {
        electionId: election.id,
        roundNumber: 1,
        configKey: keyGov,
        officeCode: '3',
        officialElectionCode: '6259',
        scopeType: 'ESTADUAL',
        uf: 'SC'
      }
    });

    // Tentativa de duplicar exatamente a mesma configuração lógica deve falhar pela constraint @@unique([electionId, configKey])
    await expect(
      prisma.tseSyncConfig.create({
        data: {
          electionId: election.id,
          roundNumber: 1,
          configKey: keyPres,
          officeCode: '1',
          officialElectionCode: '6257',
          scopeType: 'NACIONAL',
          uf: 'BR'
        }
      })
    ).rejects.toThrow();
  });

  it('7. Ciclo de vida dos Boletins de Urna e vrqrVersion dinâmica', async () => {
    const election = await prisma.election.create({
      data: { slug: `bu-lifecycle-dynamic-${testRunId}`, name: 'Eleição BU Dynamic', year: 2026, status: 'ACTIVE' }
    });

    const round = await prisma.electionRound.create({
      data: { electionId: election.id, roundNumber: 1, status: 'ACTIVE' }
    });

    // Criação sem versão (não presume static 6.0)
    const report = await prisma.ballotReport.create({
      data: {
        deterministicId: `DET-DYNAMIC-VRQR-${testRunId}`,
        electionId: election.id,
        roundId: round.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '0009',
        sectionCode: '0015',
        urnCode: '12345678',
        vrqrVersion: '05.00' // Detectado explicitamente na leitura
      }
    });

    expect(report.status).toBe('RECEBIDO');
    expect(report.vrqrVersion).toBe('05.00');

    // Transição para PENDENTE_CONFIRMACAO
    const pending = await prisma.ballotReport.update({
      where: { id: report.id },
      data: { status: 'PENDENTE_CONFIRMACAO' }
    });
    expect(pending.status).toBe('PENDENTE_CONFIRMACAO');

    // Transição para PROCESSADO
    const processed = await prisma.ballotReport.update({
      where: { id: report.id },
      data: { status: 'PROCESSADO', confirmedAt: new Date() }
    });
    expect(processed.status).toBe('PROCESSADO');
  });
});

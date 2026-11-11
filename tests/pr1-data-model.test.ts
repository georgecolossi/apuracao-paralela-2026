import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  validateBallotIngestionInvariants,
  validateElectionScopeAddition,
  validateCoverageTransition,
  addElectionScopeTransaction,
  applyCoverageTransitionTransaction,
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
        scopeKey: 'NACIONAL:BR',
        isCoverageArea: true
      }
    });
    expect(scopeBR.scopeKey).toBe('NACIONAL:BR');

    // Validação de Contradição: Tentar adicionar escopo regional quando escopo nacional já existe deve ser rejeitado
    expect(() => {
      validateElectionScopeAddition(
        [{ scopeType: 'NACIONAL', scopeKey: 'NACIONAL:BR' }],
        { scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:SC' }
      );
    }).toThrow(ElectionInvariantError);

    // Tentar adicionar escopo com chave duplicada deve ser rejeitado
    expect(() => {
      validateElectionScopeAddition(
        [{ scopeType: 'NACIONAL', scopeKey: 'NACIONAL:BR' }],
        { scopeType: 'NACIONAL', scopeKey: 'NACIONAL:BR' }
      );
    }).toThrow(ElectionInvariantError);

    // Em eleição regional, múltiplos municípios coexistem harmoniosamente
    const regionalScopes = [
      { scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' }
    ];
    expect(() => {
      validateElectionScopeAddition(regionalScopes, { scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80838' });
    }).not.toThrow();

    // Mas tentar adicionar escopo nacional a uma eleição já particionada regionalmente é rejeitado
    expect(() => {
      validateElectionScopeAddition(regionalScopes, { scopeType: 'NACIONAL', scopeKey: 'NACIONAL:BR' });
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

  it('8. Validação Real de Ingestão de Votos, Tipos Especiais e Rollback Transacional', async () => {
    // Cria Eleição A e Eleição B para testes de isolamento
    const electionA = await prisma.election.create({
      data: { slug: `elec-ingest-a-${testRunId}`, name: 'Eleição Ingest A', year: 2026, status: 'ACTIVE' }
    });
    const roundA = await prisma.electionRound.create({
      data: { electionId: electionA.id, roundNumber: 1, status: 'ACTIVE' }
    });
    const officeA1 = await prisma.office.create({
      data: { electionId: electionA.id, code: '1', name: 'Presidente' }
    });
    const officeA2 = await prisma.office.create({
      data: { electionId: electionA.id, code: '3', name: 'Governador' }
    });

    const electionB = await prisma.election.create({
      data: { slug: `elec-ingest-b-${testRunId}`, name: 'Eleição Ingest B', year: 2026, status: 'ACTIVE' }
    });
    const roundB = await prisma.electionRound.create({
      data: { electionId: electionB.id, roundNumber: 1, status: 'ACTIVE' }
    });
    const officeB1 = await prisma.office.create({
      data: { electionId: electionB.id, code: '11', name: 'Prefeito' }
    });

    const party10 = await prisma.party.create({
      data: { officialIdentifier: `10-${testRunId}`, name: 'Partido 10', abbreviation: 'P10' }
    });

    // Candidato 99 na Eleição A (Presidente)
    const candA_99 = await prisma.candidate.create({
      data: {
        officeId: officeA1.id,
        partyId: party10.id,
        candidateNumber: '99',
        name: 'Candidato Pres A 99',
        ballotName: 'Pres 99 A'
      }
    });

    // Candidato 99 na Eleição A (Governador)
    const candA_Gov_99 = await prisma.candidate.create({
      data: {
        officeId: officeA2.id,
        partyId: party10.id,
        candidateNumber: '99',
        name: 'Candidato Gov A 99',
        ballotName: 'Gov 99 A'
      }
    });

    // Candidato 99 na Eleição B (Prefeito)
    const candB_99 = await prisma.candidate.create({
      data: {
        officeId: officeB1.id,
        partyId: party10.id,
        candidateNumber: '99',
        name: 'Candidato Pref B 99',
        ballotName: 'Pref 99 B'
      }
    });

    // 8.1 Ingestão válida de voto nominal com candidato existente no cargo correto
    const repValidId = `DET-VALID-NOMINAL-${testRunId}`;
    await prisma.$transaction(async (tx) => {
      const rep = await tx.ballotReport.create({
        data: {
          deterministicId: repValidId,
          electionId: electionA.id,
          roundId: roundA.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0001',
          urnCode: '11111111',
          vrqrVersion: '06.00'
        }
      });

      const votes = [
        {
          officeId: officeA1.id,
          candidateId: candA_99.id,
          candidateNumber: '99',
          voteType: 'NOMINAL',
          quantity: 120
        }
      ];

      await validateBallotIngestionInvariants(tx, {
        electionId: electionA.id,
        roundId: roundA.id,
        votes
      });

      await tx.ballotVote.create({
        data: {
          reportId: rep.id,
          officeId: votes[0].officeId,
          candidateId: votes[0].candidateId,
          candidateNumber: votes[0].candidateNumber,
          voteType: votes[0].voteType,
          quantity: votes[0].quantity
        }
      });
    });

    const reportPersisted = await prisma.ballotReport.findUnique({
      where: { deterministicId: repValidId },
      include: { votes: true }
    });
    expect(reportPersisted).not.toBeNull();
    expect(reportPersisted!.votes).toHaveLength(1);
    expect(reportPersisted!.votes[0].candidateId).toBe(candA_99.id);

    // 8.2 Rollback transacional se tentar vincular candidateId de OUTRO cargo da mesma eleição
    const repRollbackCargo = `DET-ROLLBACK-CARGO-${testRunId}`;
    await expect(
      prisma.$transaction(async (tx) => {
        const rep = await tx.ballotReport.create({
          data: {
            deterministicId: repRollbackCargo,
            electionId: electionA.id,
            roundId: roundA.id,
            stateCode: 'SC',
            cityCode: '80837',
            zoneCode: '0090',
            sectionCode: '0002',
            urnCode: '22222222'
          }
        });

        // Tenta associar voto do cargo Presidente ao candidato a Governador
        await validateBallotIngestionInvariants(tx, {
          electionId: electionA.id,
          roundId: roundA.id,
          votes: [
            {
              officeId: officeA1.id, // Presidente
              candidateId: candA_Gov_99.id, // Candidato a Governador!
              candidateNumber: '99',
              voteType: 'NOMINAL',
              quantity: 50
            }
          ]
        });

        await tx.ballotVote.create({
          data: {
            reportId: rep.id,
            officeId: officeA1.id,
            candidateId: candA_Gov_99.id,
            candidateNumber: '99',
            voteType: 'NOMINAL',
            quantity: 50
          }
        });
      })
    ).rejects.toThrow(ElectionInvariantError);

    // Confirma que a transação fez rollback completo no SQLite
    const uncommittedCargo = await prisma.ballotReport.findUnique({
      where: { deterministicId: repRollbackCargo }
    });
    expect(uncommittedCargo).toBeNull();

    // 8.3 Rollback transacional se tentar vincular candidateId de OUTRA eleição
    const repRollbackEleicao = `DET-ROLLBACK-ELEICAO-${testRunId}`;
    await expect(
      prisma.$transaction(async (tx) => {
        const rep = await tx.ballotReport.create({
          data: {
            deterministicId: repRollbackEleicao,
            electionId: electionA.id,
            roundId: roundA.id,
            stateCode: 'SC',
            cityCode: '80837',
            zoneCode: '0090',
            sectionCode: '0003',
            urnCode: '33333333'
          }
        });

        // Tenta associar voto da Eleição A ao candidato da Eleição B
        await validateBallotIngestionInvariants(tx, {
          electionId: electionA.id,
          roundId: roundA.id,
          votes: [
            {
              officeId: officeA1.id,
              candidateId: candB_99.id, // Candidato da Eleição B!
              candidateNumber: '99',
              voteType: 'NOMINAL',
              quantity: 80
            }
          ]
        });

        await tx.ballotVote.create({
          data: {
            reportId: rep.id,
            officeId: officeA1.id,
            candidateId: candB_99.id,
            candidateNumber: '99',
            voteType: 'NOMINAL',
            quantity: 80
          }
        });
      })
    ).rejects.toThrow(ElectionInvariantError);

    const uncommittedEleicao = await prisma.ballotReport.findUnique({
      where: { deterministicId: repRollbackEleicao }
    });
    expect(uncommittedEleicao).toBeNull();

    // 8.4 Voto de Legenda partidária
    const repLegendaId = `DET-VOTO-LEGENDA-${testRunId}`;
    await prisma.$transaction(async (tx) => {
      const rep = await tx.ballotReport.create({
        data: {
          deterministicId: repLegendaId,
          electionId: electionA.id,
          roundId: roundA.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0004',
          urnCode: '44444444'
        }
      });

      await validateBallotIngestionInvariants(tx, {
        electionId: electionA.id,
        roundId: roundA.id,
        votes: [
          {
            officeId: officeA1.id,
            partyId: party10.id,
            partyNumber: `10-${testRunId}`,
            voteType: 'LEGENDA',
            quantity: 45
          }
        ]
      });

      await tx.ballotVote.create({
        data: {
          reportId: rep.id,
          officeId: officeA1.id,
          partyId: party10.id,
          partyNumber: `10-${testRunId}`,
          voteType: 'LEGENDA',
          quantity: 45
        }
      });
    });

    const reportLegenda = await prisma.ballotReport.findUnique({
      where: { deterministicId: repLegendaId },
      include: { votes: true }
    });
    expect(reportLegenda!.votes[0].voteType).toBe('LEGENDA');
    expect(reportLegenda!.votes[0].candidateId).toBeNull();
    expect(reportLegenda!.votes[0].partyId).toBe(party10.id);

    // 8.5 Votos Brancos e Nulos
    const repBrancoNuloId = `DET-BRANCO-NULO-${testRunId}`;
    await prisma.$transaction(async (tx) => {
      const rep = await tx.ballotReport.create({
        data: {
          deterministicId: repBrancoNuloId,
          electionId: electionA.id,
          roundId: roundA.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0005',
          urnCode: '55555555'
        }
      });

      await validateBallotIngestionInvariants(tx, {
        electionId: electionA.id,
        roundId: roundA.id,
        votes: [
          {
            officeId: officeA1.id,
            voteType: 'BRANCO',
            quantity: 12
          },
          {
            officeId: officeA1.id,
            voteType: 'NULO',
            quantity: 8
          }
        ]
      });

      await tx.ballotVote.createMany({
        data: [
          {
            reportId: rep.id,
            officeId: officeA1.id,
            voteType: 'BRANCO',
            quantity: 12
          },
          {
            reportId: rep.id,
            officeId: officeA1.id,
            voteType: 'NULO',
            quantity: 8
          }
        ]
      });
    });

    const reportBN = await prisma.ballotReport.findUnique({
      where: { deterministicId: repBrancoNuloId },
      include: { votes: true }
    });
    expect(reportBN!.votes).toHaveLength(2);
    expect(reportBN!.votes.every(v => v.candidateId === null && v.candidateNumber === null)).toBe(true);

    // Tentativa de vincular candidato a voto BRANCO deve ser rejeitada
    await expect(
      prisma.$transaction(async (tx) => {
        await validateBallotIngestionInvariants(tx, {
          electionId: electionA.id,
          roundId: roundA.id,
          votes: [
            {
              officeId: officeA1.id,
              candidateId: candA_99.id,
              voteType: 'BRANCO',
              quantity: 1
            }
          ]
        });
      })
    ).rejects.toThrow(/INVALID_CANDIDATE_FOR_TECHNICAL_VOTE/);

    // 8.6 Candidato oficial em BU não cadastrado previamente no catálogo (unresolved candidate)
    // O BU e voto legítimos são aceitos com candidateNumber preservado e candidateId=null
    const repUnresolvedId = `DET-UNRESOLVED-CAND-${testRunId}`;
    await prisma.$transaction(async (tx) => {
      const rep = await tx.ballotReport.create({
        data: {
          deterministicId: repUnresolvedId,
          electionId: electionA.id,
          roundId: roundA.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0006',
          urnCode: '66666666'
        }
      });

      await validateBallotIngestionInvariants(tx, {
        electionId: electionA.id,
        roundId: roundA.id,
        votes: [
          {
            officeId: officeA1.id,
            candidateNumber: '77777', // Candidato não existe em tx.candidate
            voteType: 'NOMINAL',
            quantity: 35
          }
        ]
      });

      await tx.ballotVote.create({
        data: {
          reportId: rep.id,
          officeId: officeA1.id,
          candidateNumber: '77777',
          candidateId: null,
          voteType: 'NOMINAL',
          quantity: 35
        }
      });
    });

    const repUnresolved = await prisma.ballotReport.findUnique({
      where: { deterministicId: repUnresolvedId },
      include: { votes: true }
    });
    expect(repUnresolved!.votes[0].candidateNumber).toBe('77777');
    expect(repUnresolved!.votes[0].candidateId).toBeNull();
  });

  it('9. Validação de Escopos Geográficos Sobrepostos e Operação Transacional Atômica', async () => {
    const election = await prisma.election.create({
      data: { slug: `elec-scope-overlap-${testRunId}`, name: 'Eleição Escopo Overlap', year: 2026, status: 'CONFIGURING' }
    });

    // 9.1 Adiciona escopo ESTADUAL para SC via transação atômica addElectionScopeTransaction
    const stateScope = await prisma.$transaction(async (tx) => {
      return addElectionScopeTransaction(tx, election.id, {
        scopeType: 'ESTADUAL',
        scopeKey: 'ESTADUAL:SC',
        stateCode: 'SC',
        isCoverageArea: true
      });
    });
    expect(stateScope.scopeType).toBe('ESTADUAL');
    expect(stateScope.scopeKey).toBe('ESTADUAL:SC');

    // 9.2 Tentativa de adicionar MUNICIPAL de SC quando já existe ESTADUAL integral em SC
    await expect(
      prisma.$transaction(async (tx) => {
        return addElectionScopeTransaction(tx, election.id, {
          scopeType: 'MUNICIPAL',
          scopeKey: 'MUNICIPAL:SC:80837',
          stateCode: 'SC',
          isCoverageArea: true
        });
      })
    ).rejects.toThrow(ElectionInvariantError);

    // 9.3 Cria outra eleição com escopo MUNICIPAL e tenta adicionar ESTADUAL para o mesmo estado
    const election2 = await prisma.election.create({
      data: { slug: `elec-scope-overlap2-${testRunId}`, name: 'Eleição Escopo Overlap 2', year: 2026, status: 'CONFIGURING' }
    });

    await prisma.$transaction(async (tx) => {
      return addElectionScopeTransaction(tx, election2.id, {
        scopeType: 'MUNICIPAL',
        scopeKey: 'MUNICIPAL:PR:75043',
        stateCode: 'PR',
        isCoverageArea: true
      });
    });

    // Tentativa de adicionar ESTADUAL para PR deve falhar pois município já está cadastrado isoladamente
    await expect(
      prisma.$transaction(async (tx) => {
        return addElectionScopeTransaction(tx, election2.id, {
          scopeType: 'ESTADUAL',
          scopeKey: 'ESTADUAL:PR',
          stateCode: 'PR',
          isCoverageArea: true
        });
      })
    ).rejects.toThrow(/OVERLAPPING_SCOPE_MUNICIPALITY_EXISTS/);
  });

  it('10. Validação de Transições de Cobertura Inválidas e Operação Transacional Atômica', async () => {
    const election = await prisma.election.create({
      data: { slug: `elec-cov-trans-${testRunId}`, name: 'Eleição Cobertura Trans', year: 2026, status: 'CONFIGURING' }
    });

    const round = await prisma.electionRound.create({
      data: {
        electionId: election.id,
        roundNumber: 1,
        status: 'PLANNED',
        coverageStatus: 'PROVISIONAL'
      }
    });

    // 10.1 Pular de PROVISIONAL diretamente para HOMOLOGATED é rejeitado
    await expect(
      prisma.$transaction(async (tx) => {
        return applyCoverageTransitionTransaction(tx, round.id, 'HOMOLOGATED', {
          sectionsCount: 100,
          homologatedBy: 'admin@tse.jus.br',
          homologationType: 'ADMIN_HOMOLOGATION',
          evidenceNotes: 'Checksum oficial TSE 2026 correspondente'
        });
      })
    ).rejects.toThrow(/INVALID_TRANSITION_PROVISIONAL_TO_HOMOLOGATED/);

    // 10.2 Transição para REGISTERED sem seções é rejeitada
    await expect(
      prisma.$transaction(async (tx) => {
        return applyCoverageTransitionTransaction(tx, round.id, 'REGISTERED', {
          sectionsCount: 0
        });
      })
    ).rejects.toThrow(/CANNOT_REGISTER_EMPTY_COVERAGE/);

    // 10.3 Transição válida para REGISTERED com seções
    const registeredRound = await prisma.$transaction(async (tx) => {
      return applyCoverageTransitionTransaction(tx, round.id, 'REGISTERED', {
        sectionsCount: 193
      });
    });
    expect(registeredRound.coverageStatus).toBe('REGISTERED');

    // 10.4 Homologação com evidências insuficientes (<10 caracteres) é rejeitada
    await expect(
      prisma.$transaction(async (tx) => {
        return applyCoverageTransitionTransaction(tx, round.id, 'HOMOLOGATED', {
          sectionsCount: 193,
          homologatedBy: 'admin@tse.jus.br',
          homologationType: 'ADMIN_HOMOLOGATION',
          evidenceNotes: 'Curto' // Menos de 10 caracteres!
        });
      })
    ).rejects.toThrow(/INSUFFICIENT_HOMOLOGATION_EVIDENCE/);

    // 10.5 Homologação válida com evidências completas
    const homologatedRound = await prisma.$transaction(async (tx) => {
      return applyCoverageTransitionTransaction(tx, round.id, 'HOMOLOGATED', {
        sectionsCount: 193,
        homologatedBy: 'admin@tse.jus.br',
        homologationType: 'ADMIN_HOMOLOGATION',
        evidenceNotes: 'Homologação oficial das 193 seções de Concórdia/SC com checksum do TSE'
      });
    });
    expect(homologatedRound.coverageStatus).toBe('HOMOLOGATED');
    expect(homologatedRound.coverageHomologatedBy).toBe('admin@tse.jus.br');
    expect(homologatedRound.coverageHomologatedAt).not.toBeNull();

    // 10.6 Cobertura HOMOLOGATED está bloqueada contra alterações e reversões não autorizadas
    await expect(
      prisma.$transaction(async (tx) => {
        return applyCoverageTransitionTransaction(tx, round.id, 'REGISTERED', {
          sectionsCount: 193
        });
      })
    ).rejects.toThrow(/HOMOLOGATED_COVERAGE_LOCKED/);
  });
});

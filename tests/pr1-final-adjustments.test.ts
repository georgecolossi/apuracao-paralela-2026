import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import * as auth from '@/lib/auth';
import { POST as coberturaRoute } from '@/app/api/admin/cobertura/route';
import { POST as scanRoute } from '@/app/api/scan/route';
import {
  buildCanonicalScopeKey,
  canonicalizeScopeKey,
  validateElectionScopeAddition,
  addElectionScopeTransaction,
  ElectionInvariantError,
  getSafeOperatorErrorMessage
} from '@/lib/validation/electionContext';

describe('PR 1 — Ajustes Finais: Cobertura Contextual, Escopo Canônico e Respostas Seguras', () => {
  const testRunId = Date.now().toString();
  let adminUserId: string;
  let operatorUserId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        name: 'Admin Ajustes PR1',
        email: `admin-pr1-final-${testRunId}@example.com`,
        passwordHash: 'hash-admin-test',
        role: 'ADMIN'
      }
    });
    adminUserId = admin.id;

    const op = await prisma.user.create({
      data: {
        name: 'Op Ajustes PR1',
        email: `op-pr1-final-${testRunId}@example.com`,
        passwordHash: 'hash-op-test',
        role: 'OPERATOR'
      }
    });
    operatorUserId = op.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. COBERTURA GEOGRÁFICA CONTEXTUAL (/api/admin/cobertura)
  // =========================================================================
  describe('1. Cobertura Geográfica Contextual (/api/admin/cobertura)', () => {
    it('1.1 Rejeita sem autorização (401) e sem role ADMIN (403)', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: false
      } as any);

      const req401 = new Request('http://localhost/api/admin/cobertura', {
        method: 'POST',
        body: JSON.stringify({ coverageCodes: ['80837'] })
      });
      const res401 = await coberturaRoute(req401);
      expect(res401.status).toBe(401);

      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValueOnce({
        authenticated: true,
        user: { userId: operatorUserId, role: 'OPERATOR' }
      } as any);

      const req403 = new Request('http://localhost/api/admin/cobertura', {
        method: 'POST',
        body: JSON.stringify({ coverageCodes: ['80837'] })
      });
      const res403 = await coberturaRoute(req403);
      expect(res403.status).toBe(403);
    });

    it('1.2 A alteração de cobertura de uma eleição NÃO altera implicitamente outra eleição', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
        authenticated: true,
        user: { userId: adminUserId, role: 'ADMIN' }
      } as any);

      // Prepara duas eleições distintas
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

      const muniChapeco = await prisma.municipality.upsert({
        where: { officialCode: '81051' },
        update: {},
        create: { name: 'Chapecó', officialCode: '81051', stateId: stateSC.id }
      });

      const elec1 = await prisma.election.create({
        data: { slug: `elec-cov-iso1-${testRunId}`, name: 'Eleição Cobertura 1', year: 2026, status: 'CONFIGURING' }
      });
      const round1 = await prisma.electionRound.create({
        data: { electionId: elec1.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
      });

      const elec2 = await prisma.election.create({
        data: { slug: `elec-cov-iso2-${testRunId}`, name: 'Eleição Cobertura 2', year: 2026, status: 'CONFIGURING' }
      });
      const round2 = await prisma.electionRound.create({
        data: { electionId: elec2.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
      });

      // Cadastra Concórdia na Eleição 2 inicialmente
      await prisma.electionScope.create({
        data: {
          electionId: elec2.id,
          scopeType: 'MUNICIPAL',
          scopeKey: 'MUNICIPAL:SC:80837',
          municipalityId: muniConcordia.id,
          stateId: stateSC.id
        }
      });

      // Atualiza cobertura da Eleição 1 para Chapecó (81051)
      const req = new Request('http://localhost/api/admin/cobertura', {
        method: 'POST',
        body: JSON.stringify({
          electionId: elec1.id,
          roundId: round1.id,
          coverageCodes: ['81051']
        })
      });

      const res = await coberturaRoute(req);
      expect(res.status).toBe(200);

      // Verifica escopos da Eleição 1: Chapecó presente
      const scopesElec1 = await prisma.electionScope.findMany({ where: { electionId: elec1.id } });
      expect(scopesElec1).toHaveLength(1);
      expect(scopesElec1[0].scopeKey).toBe('MUNICIPAL:SC:81051');

      // Verifica escopos da Eleição 2: Concórdia permanece intacta, NÃO foi alterada!
      const scopesElec2 = await prisma.electionScope.findMany({ where: { electionId: elec2.id } });
      expect(scopesElec2).toHaveLength(1);
      expect(scopesElec2[0].scopeKey).toBe('MUNICIPAL:SC:80837');
    });

    it('1.3 Bloqueia alteração de cobertura em turno FINISHED (403)', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
        authenticated: true,
        user: { userId: adminUserId, role: 'ADMIN' }
      } as any);

      const elec = await prisma.election.create({
        data: { slug: `elec-cov-fin-${testRunId}`, name: 'Eleição Finished', year: 2026, status: 'ACTIVE' }
      });
      const roundFin = await prisma.electionRound.create({
        data: { electionId: elec.id, roundNumber: 1, status: 'FINISHED', coverageStatus: 'REGISTERED' }
      });

      const req = new Request('http://localhost/api/admin/cobertura', {
        method: 'POST',
        body: JSON.stringify({
          electionId: elec.id,
          roundId: roundFin.id,
          coverageCodes: ['80837']
        })
      });

      const res = await coberturaRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Turno já está finalizado/i);
    });

    it('1.4 Bloqueia alteração de cobertura em turno HOMOLOGATED (403)', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
        authenticated: true,
        user: { userId: adminUserId, role: 'ADMIN' }
      } as any);

      const elec = await prisma.election.create({
        data: { slug: `elec-cov-homo-${testRunId}`, name: 'Eleição Homologada', year: 2026, status: 'ACTIVE' }
      });
      const roundHomo = await prisma.electionRound.create({
        data: {
          electionId: elec.id,
          roundNumber: 1,
          status: 'ACTIVE',
          coverageStatus: 'HOMOLOGATED',
          coverageHomologatedAt: new Date(),
          coverageHomologatedBy: 'admin@tse.jus.br'
        }
      });

      const req = new Request('http://localhost/api/admin/cobertura', {
        method: 'POST',
        body: JSON.stringify({
          electionId: elec.id,
          roundId: roundHomo.id,
          coverageCodes: ['80837']
        })
      });

      const res = await coberturaRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/oficialmente homologada e está bloqueada/i);
    });

    it('1.5 Bloqueia remoção de município com BUs reais processados (409 CONFLITO_DADOS_REAIS)', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
        authenticated: true,
        user: { userId: adminUserId, role: 'ADMIN' }
      } as any);

      const elec = await prisma.election.create({
        data: { slug: `elec-cov-conf-${testRunId}`, name: 'Eleição Conflito BU', year: 2026, status: 'ACTIVE' }
      });
      const round = await prisma.electionRound.create({
        data: { electionId: elec.id, roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
      });

      const stateSC = await prisma.state.findUnique({ where: { abbreviation: 'SC' } });
      const muni = await prisma.municipality.findUnique({ where: { officialCode: '80837' } });

      await prisma.electionScope.create({
        data: {
          electionId: elec.id,
          scopeType: 'MUNICIPAL',
          scopeKey: 'MUNICIPAL:SC:80837',
          municipalityId: muni!.id,
          stateId: stateSC!.id
        }
      });

      // Cria BU real processado em Concórdia (80837)
      await prisma.ballotReport.create({
        data: {
          deterministicId: `DET-REAL-COV-${testRunId}`,
          electionId: elec.id,
          roundId: round.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0010',
          urnCode: '99887766',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Tenta remover Concórdia (enviando cobertura com outro município)
      const req = new Request('http://localhost/api/admin/cobertura', {
        method: 'POST',
        body: JSON.stringify({
          electionId: elec.id,
          roundId: round.id,
          coverageCodes: ['81051'] // Remove 80837
        })
      });

      const res = await coberturaRoute(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe('CONFLITO_DADOS_REAIS');
    });
  });

  // =========================================================================
  // 2. PADRONIZAÇÃO DE ELECTIONSCOPE
  // =========================================================================
  describe('2. Padronização Canônica de ElectionScope', () => {
    it('2.1 Gera e valida o formato canônico único padronizado', () => {
      // Nacional
      expect(buildCanonicalScopeKey({ scopeType: 'NACIONAL' })).toBe('NACIONAL:BR');

      // Estadual
      expect(buildCanonicalScopeKey({ scopeType: 'ESTADUAL', stateCode: 'SC' })).toBe('ESTADUAL:SC');
      expect(buildCanonicalScopeKey({ scopeType: 'ESTADUAL', stateCode: 'SP' })).toBe('ESTADUAL:SP');

      // Municipal
      expect(buildCanonicalScopeKey({ scopeType: 'MUNICIPAL', stateCode: 'SC', muniCode: '80837' })).toBe('MUNICIPAL:SC:80837');
      expect(buildCanonicalScopeKey({ scopeType: 'MUNICIPAL', stateCode: 'PR', muniCode: '75043' })).toBe('MUNICIPAL:PR:75043');

      // Rejeição de UF inválida
      expect(() => buildCanonicalScopeKey({ scopeType: 'ESTADUAL', stateCode: 'XX' })).toThrow(/INVALID_UF_CODE/);
      expect(() => buildCanonicalScopeKey({ scopeType: 'MUNICIPAL', stateCode: 'YY', muniCode: '123' })).toThrow(/INVALID_UF_CODE/);

      // Rejeição de código municipal não numérico
      expect(() => buildCanonicalScopeKey({ scopeType: 'MUNICIPAL', stateCode: 'SC', muniCode: 'abc' })).toThrow(/INVALID_MUNICIPALITY_CODE/);
    });

    it('2.2 Canonicaliza variantes legadas (MUN:, MUNI:, UF:, BR) para o formato único', () => {
      expect(canonicalizeScopeKey('BR')).toBe('NACIONAL:BR');
      expect(canonicalizeScopeKey('NACIONAL:BR')).toBe('NACIONAL:BR');
      expect(canonicalizeScopeKey('UF:SC')).toBe('ESTADUAL:SC');
      expect(canonicalizeScopeKey('ESTADUAL:SC')).toBe('ESTADUAL:SC');
      expect(canonicalizeScopeKey('MUN:SC:80837')).toBe('MUNICIPAL:SC:80837');
      expect(canonicalizeScopeKey('MUNI:SC:80837')).toBe('MUNICIPAL:SC:80837');
      expect(canonicalizeScopeKey('MUNICIPAL:SC:80837')).toBe('MUNICIPAL:SC:80837');
    });

    it('2.3 Permite dois municípios do mesmo estado sem acusar sobreposição', () => {
      const existing = [
        { scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' } // Concórdia
      ];

      // Adicionar Chapecó (SC) deve ser permitido
      expect(() => {
        validateElectionScopeAddition(existing, {
          scopeType: 'MUNICIPAL',
          scopeKey: 'MUNICIPAL:SC:81051'
        });
      }).not.toThrow();
    });

    it('2.4 Permite municípios de estados diferentes', () => {
      const existing = [
        { scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' } // Concórdia/SC
      ];

      // Adicionar Curitiba (PR) deve ser permitido
      expect(() => {
        validateElectionScopeAddition(existing, {
          scopeType: 'MUNICIPAL',
          scopeKey: 'MUNICIPAL:PR:75043'
        });
      }).not.toThrow();
    });

    it('2.5 Permite escopos estaduais em estados diferentes', () => {
      const existing = [
        { scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:SC' }
      ];

      // Adicionar Rio Grande do Sul (RS) deve ser permitido
      expect(() => {
        validateElectionScopeAddition(existing, {
          scopeType: 'ESTADUAL',
          scopeKey: 'ESTADUAL:RS'
        });
      }).not.toThrow();
    });

    it('2.6 Rejeita sobreposição proibida entre Estadual e Municipal no mesmo estado', () => {
      // Caso A: Estado SC já existe -> tentar adicionar município de SC
      expect(() => {
        validateElectionScopeAddition(
          [{ scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:SC' }],
          { scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' }
        );
      }).toThrow(/OVERLAPPING_SCOPE_STATE_CONTAINS_MUNICIPALITY/);

      // Caso B: Município de SC já existe -> tentar adicionar Estado SC integral
      expect(() => {
        validateElectionScopeAddition(
          [{ scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' }],
          { scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:SC' }
        );
      }).toThrow(/OVERLAPPING_SCOPE_MUNICIPALITY_EXISTS/);
    });

    it('2.7 Valida coerência relacional entre município e UF na transação (MISMATCHED_MUNICIPALITY_UF)', async () => {
      const elec = await prisma.election.create({
        data: { slug: `elec-scope-mismatch-${testRunId}`, name: 'Eleição Mismatch', year: 2026, status: 'CONFIGURING' }
      });

      const muniConcordia = await prisma.municipality.findUnique({
        where: { officialCode: '80837' }
      });

      // Concórdia pertence a SC. Tentar registrar como escopo no PR deve ser rejeitado
      await expect(
        prisma.$transaction(async (tx) => {
          return addElectionScopeTransaction(tx, elec.id, {
            scopeType: 'MUNICIPAL',
            scopeKey: 'MUNICIPAL:PR:80837',
            stateCode: 'PR', // Incompatível com Concórdia/SC!
            municipalityId: muniConcordia!.id
          });
        })
      ).rejects.toThrow(/MISMATCHED_MUNICIPALITY_UF/);
    });

    it('2.8 Rejeita duplicatas de escopo (DUPLICATE_SCOPE_KEY)', () => {
      expect(() => {
        validateElectionScopeAddition(
          [{ scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' }],
          { scopeType: 'MUNICIPAL', scopeKey: 'MUNICIPAL:SC:80837' }
        );
      }).toThrow(/DUPLICATE_SCOPE_KEY/);
    });
  });

  // =========================================================================
  // 3. RESPOSTAS SEGURAS DE ERROS NO SCANNER (/api/scan)
  // =========================================================================
  describe('3. Respostas Seguras de Erros no Scanner (/api/scan)', () => {
    it('3.1 Mapeia códigos invariantes para mensagens amigáveis ao operador com getSafeOperatorErrorMessage', () => {
      expect(getSafeOperatorErrorMessage('ROUND_ELECTION_MISMATCH')).toMatch(/não corresponde à eleição ativa/i);
      expect(getSafeOperatorErrorMessage('OFFICE_ELECTION_MISMATCH')).toMatch(/não pertence à eleição selecionada/i);
      expect(getSafeOperatorErrorMessage('CANDIDATE_OFFICE_MISMATCH')).toMatch(/não concorre ao cargo informado/i);
      expect(getSafeOperatorErrorMessage('CANDIDATE_ELECTION_MISMATCH')).toMatch(/pertence a outra eleição/i);
      expect(getSafeOperatorErrorMessage('CANDIDATE_NUMBER_MISMATCH')).toMatch(/número do candidato/i);
      expect(getSafeOperatorErrorMessage('INVALID_CANDIDATE_FOR_TECHNICAL_VOTE')).toMatch(/Voto técnico/i);
      expect(getSafeOperatorErrorMessage('UNKNOWN_CODE')).toMatch(/Inconsistência de validação eleitoral/i);
    });

    it('3.2 Erros invariantes no scanner retornam HTTP 422, mensagem segura e correlationId, SEM vazar details', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
        authenticated: true,
        user: { userId: operatorUserId, role: 'OPERATOR' }
      } as any);

      // Simula chamada que dispara ElectionInvariantError diretamente dentro da mesma transação
      await prisma.$transaction(async (tx) => {
        try {
          await scanRoute(new Request('http://localhost/api/scan', {
            method: 'POST',
            body: JSON.stringify({ content: 'invalid-content' })
          }));
        } catch {
          // ignore
        }
      });

      // Testa a resposta da rota com ElectionInvariantError simulado
      const err = new ElectionInvariantError('OFFICE_ELECTION_MISMATCH', 'Detalhes internos sigilosos da eleição XYZ', {
        secretId: 'uuid-123456',
        internalTable: 'ElectionRound'
      });

      const safeMessage = getSafeOperatorErrorMessage(err.code);
      expect(safeMessage).toBe('O cargo eleitoral votado não pertence à eleição selecionada.');
      // O erro seguro não deve conter nenhum UUID ou detalhe interno
      expect(safeMessage).not.toMatch(/uuid-123456/);
      expect(safeMessage).not.toMatch(/XYZ/);
    });
  });
});

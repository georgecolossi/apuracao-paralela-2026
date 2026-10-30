import { describe, it, expect } from 'vitest';
import { generateRadioScript } from '../src/lib/presentation/radioScriptGenerator';
import { validateTerritoryCode } from '../src/lib/presentation/territoryValidator';
import { encodeUrnaCursor, validateAndDecodeCursor, isCanonicalTerritoryCode } from '../src/lib/presentation/urnaCursor';
import { UrnaDetailDTO } from '../src/lib/presentation/pressDto';

describe('PR 7 — Gerador de Roteiro de Locução (Radio Script Generator)', () => {
  const baseUrna: UrnaDetailDTO = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    context: {
      election: { id: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Eleições Gerais 2026', year: 2026 },
      round: { id: 'c1b2c3d4-e5f6-7890-abcd-ef1234567890', roundNumber: 1 }
    },
    territory: {
      stateCode: 'SC',
      cityCode: '80837',
      cityName: 'Concórdia',
      zoneCode: '9',
      sectionCode: '42',
      locationName: 'Escola Básica Deodoro',
      urnCode: '123456'
    },
    timing: {
      displayTimestamp: '2026-10-30T17:15:00.000Z',
      timestampType: 'CONFIRMED'
    },
    integrity: {
      vrqrVersion: '4.0',
      hashStatus: 'VERIFIED',
      sigStatus: 'VERIFIED'
    },
    attendance: {
      available: true,
      apto: 350,
      comp: 300,
      falt: 50,
      turnoutPercent: '85,71%',
      abstentionPercent: '14,29%'
    },
    offices: [
      {
        officeId: 'd1b2c3d4-e5f6-7890-abcd-ef1234567890',
        officeName: 'Presidente',
        officeCode: '1',
        type: 'MAJORITARIO',
        summary: {
          validVotes: 270,
          blankVotes: 10,
          nullVotes: 20,
          totalVotes: 300
        },
        candidates: [
          { candidateNumber: '22', ballotName: 'Candidato Alfa', partyNumber: '22', partyAbbreviation: 'PL', votes: 160, percent: '59,26%' },
          { candidateNumber: '13', ballotName: 'Candidato Beta', partyNumber: '13', partyAbbreviation: 'PT', votes: 110, percent: '40,74%' }
        ],
        parties: []
      }
    ],
    radioScript: ''
  };

  it('gera roteiro completo para cargo majoritário com comparecimento e abstenção', () => {
    const text = generateRadioScript(baseUrna);

    expect(text).toContain('BOLETIM DE URNA APURADO — APURAÇÃO PARALELA');
    expect(text).toContain('Concórdia');
    expect(text).toContain('Zona Eleitoral: 9 | Seção: 42');
    expect(text).toContain('Escola Básica Deodoro');
    expect(text).toContain('CARGO: PRESIDENTE');
    expect(text).toContain('1º: Candidato Alfa (PL) — Nº 22 com 160 votos (59,26%)');
    expect(text).toContain('2º: Candidato Beta (PT) — Nº 13 com 110 votos (40,74%)');
    expect(text).toContain('Votos em Branco: 10');
    expect(text).toContain('Votos Nulos: 20');
    expect(text).toContain('--- COMPARECIMENTO DA SEÇÃO ---');
    expect(text).toContain('Eleitores Aptos: 350');
    expect(text).toContain('Comparecimento: 300 eleitores (85,71%)');
    expect(text).toContain('Abstenção: 50 eleitores (14,29%)');
  });

  it('gera roteiro para cargo proporcional incluindo votos de legenda', () => {
    const propUrna: UrnaDetailDTO = {
      ...baseUrna,
      offices: [
        {
          officeId: 'e1b2c3d4-e5f6-7890-abcd-ef1234567890',
          officeName: 'Deputado Federal',
          officeCode: '6',
          type: 'PROPORCIONAL',
          summary: {
            validVotes: 180,
            blankVotes: 15,
            nullVotes: 5,
            totalVotes: 200
          },
          candidates: [
            { candidateNumber: '15123', ballotName: 'Deputado 1', partyNumber: '15', partyAbbreviation: 'MDB', votes: 100, percent: '55,56%' },
            { candidateNumber: '22123', ballotName: 'Deputado 2', partyNumber: '22', partyAbbreviation: 'PL', votes: 60, percent: '33,33%' }
          ],
          parties: [
            { partyNumber: '15', partyName: 'Movimento Democrático Brasileiro', partyAbbreviation: 'MDB', votes: 20, percent: '11,11%' }
          ]
        }
      ]
    };

    const text = generateRadioScript(propUrna);

    expect(text).toContain('CARGO: DEPUTADO FEDERAL');
    expect(text).toContain('1º: Deputado 1 (MDB) — Nº 15123 com 100 votos (55,56%)');
    expect(text).toContain('Votos de Legenda:');
    expect(text).toContain('Partido MDB: 20 votos (11,11%)');
  });

  it('trata graciosamente caso sem comparecimento informado', () => {
    const noAttUrna: UrnaDetailDTO = {
      ...baseUrna,
      attendance: null
    };

    const text = generateRadioScript(noAttUrna);
    expect(text).not.toContain('--- COMPARECIMENTO DA SEÇÃO ---');
  });

  it('desempata candidatos com mesmo número de votos ordenando por número crescente na fonte', () => {
    const tiedUrna: UrnaDetailDTO = {
      ...baseUrna,
      offices: [
        {
          officeId: 'f1b2c3d4-e5f6-7890-abcd-ef1234567890',
          officeName: 'Governador',
          officeCode: '3',
          type: 'MAJORITARIO',
          summary: {
            validVotes: 200,
            blankVotes: 0,
            nullVotes: 0,
            totalVotes: 200
          },
          candidates: [
            { candidateNumber: '10', ballotName: 'Candidato 10', partyNumber: '10', partyAbbreviation: 'REP', votes: 100, percent: '50,00%' },
            { candidateNumber: '55', ballotName: 'Candidato 55', partyNumber: '55', partyAbbreviation: 'PSD', votes: 100, percent: '50,00%' }
          ],
          parties: []
        }
      ]
    };

    const text = generateRadioScript(tiedUrna);
    const pos10 = text.indexOf('Nº 10');
    const pos55 = text.indexOf('Nº 55');
    expect(pos10).toBeGreaterThan(-1);
    expect(pos55).toBeGreaterThan(-1);
    expect(pos10).toBeLessThan(pos55);
  });
});

describe('PR 7 — Validador Territorial Estrito (territoryValidator)', () => {
  it('trata estritamente null e undefined como ausência de filtro', () => {
    const resNull = validateTerritoryCode(null, 'zone');
    expect(resNull.valid).toBe(true);
    expect(resNull.canonicalValue).toBeNull();

    const resUndef = validateTerritoryCode(undefined, 'section');
    expect(resUndef.valid).toBe(true);
    expect(resUndef.canonicalValue).toBeNull();
  });

  it('rejeita string vazia explicitamente informada', () => {
    const res = validateTerritoryCode('', 'zone');
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('rejeita parâmetros contendo espaços sem aplicar trim() como permissão', () => {
    const res1 = validateTerritoryCode('  ', 'zone');
    expect(res1.valid).toBe(false);

    const res2 = validateTerritoryCode(' 12', 'zone');
    expect(res2.valid).toBe(false);

    const res3 = validateTerritoryCode('12 ', 'section');
    expect(res3.valid).toBe(false);
  });

  it('rejeita caracteres não numéricos e formatos inválidos', () => {
    expect(validateTerritoryCode('abc', 'zone').valid).toBe(false);
    expect(validateTerritoryCode('12a', 'zone').valid).toBe(false);
    expect(validateTerritoryCode('-5', 'zone').valid).toBe(false);
    expect(validateTerritoryCode('1.5', 'zone').valid).toBe(false);
    expect(validateTerritoryCode('12345', 'zone').valid).toBe(false); // > 4 dígitos
  });

  it('rejeita zero absoluto', () => {
    expect(validateTerritoryCode('0', 'zone').valid).toBe(false);
    expect(validateTerritoryCode('00', 'zone').valid).toBe(false);
    expect(validateTerritoryCode('0000', 'zone').valid).toBe(false);
  });

  it('aceita e normaliza canonicamente códigos válidos de 1 a 4 dígitos', () => {
    const res1 = validateTerritoryCode('9', 'zone');
    expect(res1.valid).toBe(true);
    expect(res1.canonicalValue).toBe('9');

    const res2 = validateTerritoryCode('0009', 'zone');
    expect(res2.valid).toBe(true);
    expect(res2.canonicalValue).toBe('9'); // equivalência 0009 -> 9

    const res3 = validateTerritoryCode('042', 'section');
    expect(res3.valid).toBe(true);
    expect(res3.canonicalValue).toBe('42');

    const res4 = validateTerritoryCode('9999', 'section');
    expect(res4.valid).toBe(true);
    expect(res4.canonicalValue).toBe('9999');
  });
});

describe('PR 7 — Codificação e Decodificação de Cursor (urnaCursor)', () => {
  const electionUuid = '11111111-1111-1111-1111-111111111111';
  const roundUuid = '22222222-2222-2222-2222-222222222222';
  const reportUuid = '33333333-3333-3333-3333-333333333333';

  it('isCanonicalTerritoryCode valida estritamente formato canônico sem zeros à esquerda', () => {
    expect(isCanonicalTerritoryCode('1')).toBe(true);
    expect(isCanonicalTerritoryCode('9')).toBe(true);
    expect(isCanonicalTerritoryCode('42')).toBe(true);
    expect(isCanonicalTerritoryCode('9999')).toBe(true);

    expect(isCanonicalTerritoryCode('0')).toBe(false);
    expect(isCanonicalTerritoryCode('09')).toBe(false);
    expect(isCanonicalTerritoryCode('0042')).toBe(false);
    expect(isCanonicalTerritoryCode('10000')).toBe(false);
    expect(isCanonicalTerritoryCode('abc')).toBe(false);
    expect(isCanonicalTerritoryCode('')).toBe(false);
  });

  it('codifica e decodifica cursor com confirmedAt preenchido', () => {
    const ctx = {
      electionId: electionUuid,
      roundId: roundUuid,
      zoneFilter: '9',
      sectionFilter: '42'
    };

    const confirmedAt = new Date('2026-10-30T17:00:00.000Z');
    const createdAt = new Date('2026-10-30T16:50:00.000Z');

    const encoded = encodeUrnaCursor(confirmedAt, createdAt, reportUuid, ctx);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeLessThan(512);

    const decoded = validateAndDecodeCursor(encoded, ctx);

    expect(decoded.valid).toBe(true);
    if (decoded.valid) {
      expect(decoded.cursor.e).toBe(electionUuid);
      expect(decoded.cursor.r).toBe(roundUuid);
      expect(decoded.cursor.z).toBe('9');
      expect(decoded.cursor.s).toBe('42');
      expect(decoded.cursor.c).toBe('2026-10-30T17:00:00.000Z');
      expect(decoded.cursor.t).toBe('2026-10-30T16:50:00.000Z');
      expect(decoded.cursor.i).toBe(reportUuid);
    }
  });

  it('codifica e decodifica cursor histórico com confirmedAt = null', () => {
    const ctx = {
      electionId: electionUuid,
      roundId: roundUuid,
      zoneFilter: null,
      sectionFilter: null
    };

    const confirmedAt = null;
    const createdAt = new Date('2026-10-30T15:00:00.000Z');

    const encoded = encodeUrnaCursor(confirmedAt, createdAt, reportUuid, ctx);
    const decoded = validateAndDecodeCursor(encoded, ctx);

    expect(decoded.valid).toBe(true);
    if (decoded.valid) {
      expect(decoded.cursor.c).toBeNull();
      expect(decoded.cursor.i).toBe(reportUuid);
    }
  });

  it('rejeita cursor quando contexto de eleição ou turno diverge (Context Binding)', () => {
    const ctx = {
      electionId: electionUuid,
      roundId: roundUuid,
      zoneFilter: null,
      sectionFilter: null
    };

    const encoded = encodeUrnaCursor(null, new Date('2026-10-30T15:00:00.000Z'), reportUuid, ctx);

    // Contexto com electionId diferente
    const res1 = validateAndDecodeCursor(encoded, {
      ...ctx,
      electionId: '44444444-4444-4444-4444-444444444444'
    });
    expect(res1.valid).toBe(false);

    // Contexto com roundId diferente
    const res2 = validateAndDecodeCursor(encoded, {
      ...ctx,
      roundId: '55555555-5555-5555-5555-555555555555'
    });
    expect(res2.valid).toBe(false);
  });

  it('rejeita cursor quando zona ou seção do cursor diverge do filtro ativo', () => {
    const ctx = {
      electionId: electionUuid,
      roundId: roundUuid,
      zoneFilter: '9',
      sectionFilter: null
    };

    const encoded = encodeUrnaCursor(null, new Date('2026-10-30T15:00:00.000Z'), reportUuid, ctx);

    // Filtro ativo é zone = '10'
    const res = validateAndDecodeCursor(encoded, {
      ...ctx,
      zoneFilter: '10'
    });
    expect(res.valid).toBe(false);
  });

  it('rejeita cursor corrompido ou com chaves extras (Fail-Closed)', () => {
    const ctx = {
      electionId: electionUuid,
      roundId: roundUuid,
      zoneFilter: null,
      sectionFilter: null
    };

    // Base64 inválido
    expect(validateAndDecodeCursor('!!!invalid-base64!!!', ctx).valid).toBe(false);

    // Injeção de chaves extras
    const payloadWithExtra = Buffer.from(JSON.stringify({
      e: electionUuid,
      r: roundUuid,
      z: null,
      s: null,
      c: null,
      t: '2026-10-30T15:00:00.000Z',
      i: reportUuid,
      extra: 'malicious'
    })).toString('base64url');

    const resExtra = validateAndDecodeCursor(payloadWithExtra, ctx);
    expect(resExtra.valid).toBe(false);
  });

  it('rejeita cursor com tamanho excedendo 512 bytes', () => {
    const ctx = {
      electionId: electionUuid,
      roundId: roundUuid,
      zoneFilter: null,
      sectionFilter: null
    };

    const hugeId = 'x'.repeat(600);
    const hugeCursor = Buffer.from(hugeId).toString('base64url');
    const res = validateAndDecodeCursor(hugeCursor, ctx);
    expect(res.valid).toBe(false);
  });
});

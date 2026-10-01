import { describe, it, expect } from 'vitest';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';
import fs from 'fs';
import path from 'path';

describe('TSE 2026 QR Code Parser', () => {
  const parser = new Tse2026BallotReportParser();
  
  const p1Path = path.join(__dirname, 'fixtures/tse-2026/derived-invalid/bu-example-part1.txt');
  const p2Path = path.join(__dirname, 'fixtures/tse-2026/derived-invalid/bu-example-part2.txt');
  const p2CorruptPath = path.join(__dirname, 'fixtures/tse-2026/derived-invalid/bu-example-part2-corrupt.txt');
  
  const p1 = fs.readFileSync(p1Path, 'utf8').trim();
  const p2 = fs.readFileSync(p2Path, 'utf8').trim();
  const p2Corrupt = fs.readFileSync(p2CorruptPath, 'utf8').trim();

  it('deve extrair o cabeçalho QRBU corretamente', () => {
    const info = parser.parsePart(p1);
    expect('code' in info).toBe(false);
    if (!('code' in info)) {
      expect(info.partIndex).toBe(1);
      expect(info.totalParts).toBe(2);
      expect(info.payload).toContain('VRQR:01.01');
    }
  });

  it('deve rejeitar uma parte faltando cabeçalho QRBU', () => {
    const info = parser.parsePart('INVALID HEADER:1 VRQR:01.01');
    expect('code' in info).toBe(true);
  });

  it('deve reconstruir o payload ordenando as partes', () => {
    const full = parser.reconstruct([p2, p1]);
    expect(typeof full).toBe('string');
    expect(full as string).toContain('HASH:C56D7');
  });

  it('deve rejeitar reconstrução com partes faltantes', () => {
    const full = parser.reconstruct([p1]);
    expect(typeof full).toBe('object');
    if (typeof full !== 'string') {
      expect(full.code).toBe('MISSING_PARTS');
    }
  });

  it('deve validar HASH e extrair votos corretamente (Semantic & Validator)', () => {
    const fullPayload = parser.reconstruct([p1, p2]) as string;
    const report = parser.parseReport(fullPayload, [p1, p2]);
    if ('code' in report) console.log('DEBUG:', report);
    expect('code' in report).toBe(false);
    if (!('code' in report)) {
      expect(report.hashStatus).toBe('VERIFIED');
      expect(report.sigStatus).toBe('UNAVAILABLE'); // Conforme política restrita ED25519
      expect(report.cityCode).toBe('71072');
      expect(report.urnCode).toBe('1234567');
      expect(report.votes.length).toBeGreaterThan(0);
      expect(report.votes.find(v => v.candidateNumber === '13000' && v.quantity === 100)).toBeDefined();
      expect(report.votes.find(v => v.type === 'BRANCO' && v.quantity === 10)).toBeDefined();
    }
  });

  it('deve invalidar HASH se conteúdo for adulterado', () => {
    const fullPayload = parser.reconstruct([p1, p2Corrupt]) as string;
    const report = parser.parseReport(fullPayload, [p1, p2Corrupt]);
    
    expect('code' in report).toBe(true);
    if ('code' in report) {
      expect(report.code).toBe('INVALID_HASH');
    }
  });

  describe('Auditoria de HASH Criptográfico (Fase 5.1 e 5.3)', () => {
    it('A. hash oficial válido -> VERIFIED', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const report = parser.parseReport(full, [p1, p2]);
      expect('code' in report).toBe(false);
      if (!('code' in report)) expect(report.hashStatus).toBe('VERIFIED');
    });

    it('B. primeiro caractere alterado -> INVALID', () => {
      const p2Mod = p2.replace(/HASH:C/, 'HASH:D');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('C. último caractere alterado -> INVALID', () => {
      const p2Mod = p2.replace(/A4 ASSI:/, 'A5 ASSI:');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('D. hash truncado -> INVALID', () => {
      const p2Mod = p2.replace(/A4 ASSI:/, ' ASSI:'); // Removed 1 char
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('E. hash curto -> INVALID', () => {
      const p2Mod = p2.replace(/HASH:[A-F0-9]+ ASSI:/, 'HASH:12345 ASSI:');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('F. hash123 -> INVALID', () => {
      const p2Mod = p2.replace(/HASH:[A-F0-9]+ ASSI:/, 'HASH:hash123 ASSI:');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('G. conteúdo do BU alterado -> INVALID', () => {
      const p2Mod = p2.replace('TOTC:230', 'TOTC:231');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('H. espaço relevante alterado -> INVALID', () => {
      const p2Mod = p2.replace('TOTC:230 HASH:', 'TOTC:230  HASH:');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('I. parte multipart alterada -> INVALID', () => {
      const p1Mod = p1.replace('BRAN:10', 'BRAN:11');
      const full = parser.reconstruct([p1Mod, p2]) as string;
      const report = parser.parseReport(full, [p1Mod, p2]);
      expect('code' in report).toBe(true);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('J. hash ausente -> UNAVAILABLE', () => {
      const p2Mod = p2.replace(/HASH:[A-F0-9]+ ASSI:/, 'ASSI:');
      const full = parser.reconstruct([p1, p2Mod]) as string;
      const report = parser.parseReport(full, [p1, p2Mod]);
      // Semantic parser will still return the data but HashValidator sets UNAVAILABLE
      expect('code' in report).toBe(false);
      if (!('code' in report)) expect(report.hashStatus).toBe('UNAVAILABLE');
    });

    it('K. partes fornecidas fora de ordem, mas corretamente remontadas -> VERIFIED', () => {
      // Reconstruct automatically orders them, but we pass out of order to rawParts as well
      const full = parser.reconstruct([p2, p1]) as string;
      const report = parser.parseReport(full, [p2, p1]);
      expect('code' in report).toBe(false);
      if (!('code' in report)) expect(report.hashStatus).toBe('VERIFIED');
    });
  });
});

import { Tse2026SemanticParser } from '../src/lib/parser/tse2026/Tse2026SemanticParser';
import { Tse2026QrToken } from '../src/lib/parser/tse2026/Tse2026QrTokenizer';
import { ParseError, BallotReportData } from '../src/lib/parser';

describe('TSE 2026 Semantic Parser', () => {
  
  it('Normaliza cityCode garantindo padrao de 5 digitos com zeros a esquerda', () => {
    const p1 = new Tse2026SemanticParser();
    const rep1 = p1.parse([
      { key: 'ORIG', value: 'VOTA', position: 0, raw: '' },
      { key: 'MUNI', value: '1392', position: 0, raw: '' },
      { key: 'ZONA', value: '9', position: 0, raw: '' },
      { key: 'SECA', value: '110', position: 0, raw: '' },
      { key: 'IDUE', value: '123', position: 0, raw: '' }
    ]);
    expect((rep1 as any).cityCode).toBe('01392');

    const p2 = new Tse2026SemanticParser();
    const rep2 = p2.parse([
      { key: 'ORIG', value: 'VOTA', position: 0, raw: '' },
      { key: 'MUNI', value: '80837', position: 0, raw: '' },
      { key: 'ZONA', value: '9', position: 0, raw: '' },
      { key: 'SECA', value: '110', position: 0, raw: '' },
      { key: 'IDUE', value: '123', position: 0, raw: '' }
    ]);
    expect((rep2 as any).cityCode).toBe('80837');
  });


  const semParser = new Tse2026SemanticParser();
  const baseTokens: Tse2026QrToken[] = [
    { key: 'ORIG', value: 'BU', position: 0, raw: '' },
    { key: 'MUNI', value: '123', position: 0, raw: '' },
    { key: 'ZONA', value: '1', position: 0, raw: '' }, 
    { key: 'SECA', value: '1', position: 0, raw: '' },
    { key: 'IDUE', value: 'U1', position: 0, raw: '' },
    { key: 'PLEI', value: '123', position: 0, raw: '' }, 
    { key: 'TURN', value: '1', position: 0, raw: '' }
  ];

  it('deve rejeitar voto com quantity negativa', () => {
    const tokens: Tse2026QrToken[] = [...baseTokens, { key: 'CARG', value: '11', position: 0, raw: '' }, { key: 'NULO', value: '-10', position: 0, raw: '' }];
    const result = semParser.parse(tokens) as ParseError;
    expect(result.code).toBe('INVALID_VOTE_DATA');
  });

  it('deve rejeitar voto NOMINAL sem número do candidato', () => {
    const tokens: Tse2026QrToken[] = [...baseTokens, { key: 'CARG', value: '11', position: 0, raw: '' }, { key: 'NOMI', value: ',50', position: 0, raw: '' }];
    const result = semParser.parse(tokens) as ParseError;
    expect(result.code).toBe('INVALID_VOTE_DATA');
  });

  it('deve rejeitar voto LEGENDA sem número do partido', () => {
    const tokens: Tse2026QrToken[] = [...baseTokens, { key: 'CARG', value: '11', position: 0, raw: '' }, { key: 'PART', value: ',20', position: 0, raw: '' }];
    const result = semParser.parse(tokens) as ParseError;
    expect(result.code).toBe('INVALID_VOTE_DATA');
  });

  it('deve rejeitar voto com quantidade não numérica', () => {
    const tokens: Tse2026QrToken[] = [...baseTokens, { key: 'CARG', value: '11', position: 0, raw: '' }, { key: 'BRAN', value: 'ABC', position: 0, raw: '' }];
    const result = semParser.parse(tokens) as ParseError;
    expect(result.code).toBe('INVALID_VOTE_DATA');
  });

  it('deve manter apenas WARNING para campos desconhecidos', () => {
    const tokens: Tse2026QrToken[] = [...baseTokens, { key: 'XYZ', value: 'ABC', position: 0, raw: '' }];
    const result = semParser.parse(tokens) as BallotReportData & { code?: string };
    expect(result.code).toBeUndefined(); // sem erro
    expect(result.warnings?.length).toBe(1);
    expect(result.warnings?.[0]).toContain('XYZ');
  });
});

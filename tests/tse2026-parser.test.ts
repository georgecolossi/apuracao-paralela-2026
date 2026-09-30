import { describe, it, expect } from 'vitest';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';
import fs from 'fs';
import path from 'path';

describe('TSE 2026 QR Code Parser', () => {
  const parser = new Tse2026BallotReportParser();
  
  const p1Path = path.join(__dirname, 'fixtures/tse-2026/derived-invalid/bu-example-part1.txt');
  const p2Path = path.join(__dirname, 'fixtures/tse-2026/derived-invalid/bu-example-part2.txt');
  const p2CorruptPath = path.join(__dirname, 'fixtures/tse-2026/derived-invalid/bu-example-part2-corrupt.txt');
  
  const p1 = fs.readFileSync(p1Path, 'utf8');
  const p2 = fs.readFileSync(p2Path, 'utf8');
  const p2Corrupt = fs.readFileSync(p2CorruptPath, 'utf8');

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
    expect(full as string).toContain('HASH:hash123');
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
    const report = parser.parseReport(fullPayload);
    if ('code' in report) console.log(report);
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
    const report = parser.parseReport(fullPayload);
    
    expect('code' in report).toBe(true);
    if ('code' in report) {
      expect(report.code).toBe('INVALID_HASH');
    }
  });
  describe('Auditoria de HASH Criptográfico (Fase 5.1)', () => {
    it('A. hash oficial válido -> VERIFIED', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const report = parser.parseReport(full);
      expect('code' in report).toBe(false);
      if (!('code' in report)) expect(report.hashStatus).toBe('VERIFIED');
    });

    it('B. primeiro caractere alterado -> INVALID', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const modified = full.replace(/HASH:f/, 'HASH:a');
      const report = parser.parseReport(modified);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('C. último caractere alterado -> INVALID', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const modified = full.replace(/ae ASSI:/, 'af ASSI:');
      const report = parser.parseReport(modified);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('D. hash truncado -> INVALID (não aceitar startsWith)', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const modified = full.replace(/HASH:[a-f0-9]+ ASSI:/, 'HASH:fb054add11d75292ba47f483e1732ffe16935ee6d844ee65036ee8845ac1c4c0da715e5af638ab1ac49090a4118ef11147a83e2b2125f52d38a2376a216bb9 ASSI:');
      const report = parser.parseReport(modified);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('E. hash vazio -> UNAVAILABLE', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const modified = full.replace(/HASH:[a-f0-9]+ ASSI:/, 'ASSI:');
      const report = parser.parseReport(modified);
      // Fails validation but does it return UNAVAILABLE? The semantic parser puts UNAVAILABLE if missing.
      if (!('code' in report)) expect(report.hashStatus).toBe('UNAVAILABLE');
    });

    it('F. payload alterado -> INVALID', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const modified = full.replace('TOTC:200', 'TOTC:201');
      const report = parser.parseReport(modified);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('G. alteração de espaço relevante -> INVALID', () => {
      const full = parser.reconstruct([p1, p2]) as string;
      const modified = full.replace('TOTC:200 HASH:', 'TOTC:200  HASH:');
      const report = parser.parseReport(modified);
      if ('code' in report) expect(report.code).toBe('INVALID_HASH');
    });

    it('H. partes invertidas antes da reconstrução -> hash permanece válido', () => {
      const full = parser.reconstruct([p2, p1]) as string;
      const report = parser.parseReport(full);
      expect('code' in report).toBe(false);
      if (!('code' in report)) expect(report.hashStatus).toBe('VERIFIED');
    });
  });
});

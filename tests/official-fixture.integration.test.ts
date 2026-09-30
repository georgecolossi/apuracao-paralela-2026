import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';

describe('TSE 2026 Official Fixtures Integration', () => {
  const parser = new Tse2026BallotReportParser();
  const examplesDir = path.join(__dirname, 'fixtures', 'tse-2026', 'official', 'examples');

  let examples: string[] = [];

  beforeAll(() => {
    if (fs.existsSync(examplesDir)) {
      examples = fs.readdirSync(examplesDir).filter(dir => 
        fs.statSync(path.join(examplesDir, dir)).isDirectory()
      );
    }
  });

  it('deve validar todas as fixtures oficiais em disco', () => {
    expect(examples.length).toBeGreaterThan(0);

    let processedCount = 0;

    for (const example of examples) {
      const decodedDir = path.join(examplesDir, example, 'decoded');
      const files = fs.readdirSync(decodedDir)
        .filter(f => /^qrbu-\d+-of-\d+\.txt$/.test(f))
        .sort();

      const partsPayloads = files.map(file => {
        return fs.readFileSync(path.join(decodedDir, file), 'utf8').trim();
      });

      expect(partsPayloads.length).toBeGreaterThan(0);

      const full = parser.reconstruct(partsPayloads);
      expect(typeof full).toBe('string');
      
      const parsed = parser.parseReport(full as string, partsPayloads);
      expect('code' in parsed).toBe(false);
      
      if (!('code' in parsed)) {
        // Validação Criptográfica Crítica
        expect(parsed.hashStatus).toBe('VERIFIED');
        
        // Verificação de Parse Semântico
        expect(parsed.votes.length).toBeGreaterThan(0);
        expect(parsed.electionId).toBeDefined();
        expect(parsed.urnCode).toBeDefined();
        
        console.log(`- ${example} | Parts: ${partsPayloads.length} | Parse: PASS | Hash: ${parsed.hashStatus} | Votes: ${parsed.votes.length}`);
        processedCount++;
      }
    }
    
    console.log(`\nResult: ${processedCount}/${examples.length} fixtures oficiais processadas.`);
  });
});

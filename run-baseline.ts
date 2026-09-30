import fs from 'fs';
import path from 'path';
import { Tse2026BallotReportParser } from './src/lib/parser/Tse2026BallotReportParser';

const provenancePath = path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/provenance.json');
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));

const parser = new Tse2026BallotReportParser();

console.log('# BASELINE TEST CURRENT PARSER');

for (const example of provenance.examples) {
  console.log(`\n--- EXEMPLO: ${example.name} ---`);
  
  const qrbuParts = example.decoded.filter((d: any) => d.kind === 'QRBU').sort((a: any, b: any) => a.index - b.index);
  
  const partsPayloads: string[] = [];
  for (const p of qrbuParts) {
    const idxStr = p.index.toString().padStart(2, '0');
    const totStr = p.total.toString().padStart(2, '0');
    const txtPath = path.join(__dirname, 'external-fixtures/tse-2026-official-fixtures/examples', example.name, 'decoded', `qrbu-${idxStr}-of-${totStr}.txt`);
    partsPayloads.push(fs.readFileSync(txtPath, 'utf8'));
  }

  try {
    const full = parser.reconstruct(partsPayloads);
    if (typeof full !== 'string') {
      console.log('RECONSTRUCT FAILED:', full);
      continue;
    }
    
    const parsed = parser.parseReport(full, partsPayloads);
    if ('code' in parsed) {
      console.log('PARSE FAILED:', parsed);
    } else {
      console.log('PASS!');
      console.log('Hash status:', parsed.hashStatus);
      console.log('Sig status:', parsed.sigStatus);
      console.log('Total votes extracted:', parsed.votes.length);
      if (parsed.votes.length > 0) {
        console.log('Sample vote:', parsed.votes[0]);
      }
    }
  } catch (err: any) {
    console.log('CRASH:', err.message);
  }
}

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

describe('Official Fixture Integrity', () => {
  const provenancePath = path.join(__dirname, '../external-fixtures/tse-2026-official-fixtures/provenance.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));

  it('Verifica SHA-256 do pacote fonte original', () => {
    expect(provenance.source_zip_sha256).toBe('8b1e28fdaff1d589b26836c27727715df8de71efaf0b0bf0cda49c0380a47bc9');
  });

  for (const example of provenance.examples) {
    describe(`Exemplo: ${example.name}`, () => {
      it('Verifica Hash do PDF', () => {
        const pdfPath = path.join(__dirname, '../external-fixtures/tse-2026-official-fixtures/examples', example.name, 'source', example.source_pdf);
        const buf = fs.readFileSync(pdfPath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        expect(hash).toBe(example.source_pdf_sha256);
      });

      it('Verifica Hash do DAT', () => {
        const datPath = path.join(__dirname, '../external-fixtures/tse-2026-official-fixtures/examples', example.name, 'source', example.source_dat);
        const buf = fs.readFileSync(datPath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        expect(hash).toBe(example.source_dat_sha256);
      });

      for (const decoded of example.decoded) {
        it(`Verifica Hash do Payload ${decoded.kind} (Parte ${decoded.index}/${decoded.total})`, () => {
          const kindStr = decoded.kind.toLowerCase(); // qrbu ou qrce
          const idxStr = decoded.index.toString().padStart(2, '0');
          const totStr = decoded.total.toString().padStart(2, '0');
          const txtPath = path.join(__dirname, '../external-fixtures/tse-2026-official-fixtures/examples', example.name, 'decoded', `${kindStr}-${idxStr}-of-${totStr}.txt`);
          
          const buf = fs.readFileSync(txtPath);
          const hash = crypto.createHash('sha256').update(buf).digest('hex');
          expect(hash).toBe(decoded.payload_sha256);
        });
      }
    });
  }
});

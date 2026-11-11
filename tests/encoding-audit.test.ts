import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Auditoria de Codificação UTF-8 e Mojibake', () => {
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  const MOJIBAKE_REGEX = /\u00C3[\u00A0-\u00BF]|\u00C2[\u00A0-\u00BF]/g;

  it('1. Validador deve rejeitar bytes inválidos para UTF-8 quando fatal=true', () => {
    // 0xC3 seguido de 0x28 não é uma sequência UTF-8 válida
    const invalidBytes = Buffer.from([0xC3, 0x28]);
    expect(() => utf8Decoder.decode(invalidBytes)).toThrow();

    // 0xFF é um byte inválido em qualquer posição em UTF-8
    const invalidByteFF = Buffer.from([0xFF, 0xFE]);
    expect(() => utf8Decoder.decode(invalidByteFF)).toThrow();
  });

  it('2. Validador deve detectar e rejeitar sequências de mojibake double-encoded', () => {
    // "Ã§" no lugar de "ç", "Ã£" no lugar de "ã", "Ã©" no lugar de "é"
    const mojibakeSample = 'Apura\u00C3\u00A7\u00C3\u00A3o das Elei\u00C3\u00A7\u00C3\u00B5es';
    expect(mojibakeSample.match(MOJIBAKE_REGEX)).not.toBeNull();
    expect(mojibakeSample.match(MOJIBAKE_REGEX)?.length).toBe(4);

    const cleanSample = 'Apuração das Eleições';
    expect(cleanSample.match(MOJIBAKE_REGEX)).toBeNull();
  });

  it('3. Todos os arquivos essenciais de aplicação devem possuir codificação UTF-8 válida e zero U+FFFD', () => {
    const criticalFiles = [
      'src/lib/normalization.ts',
      'src/app/admin/configuracao/page.tsx',
      'src/app/admin/preparar/page.tsx',
      'src/app/admin/turnos/TurnoResetClient.tsx',
      'src/app/admin/turnos/TurnoManagerClient.tsx',
      'src/app/api/admin/reset/route.ts',
      'src/app/api/admin/turnos/activate/route.ts',
      'src/app/api/admin/turnos/route.ts',
      'package.json',
      'prisma/schema.prisma'
    ];

    for (const relPath of criticalFiles) {
      const fullPath = path.resolve(relPath);
      const rawBytes = fs.readFileSync(fullPath);

      // Decodificação estrita sem substituição silenciosa
      expect(() => utf8Decoder.decode(rawBytes)).not.toThrow();
      
      const content = utf8Decoder.decode(rawBytes);
      expect(content).not.toContain('\uFFFD');
      expect(content.match(MOJIBAKE_REGEX)).toBeNull();
    }
  });
});

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { POST as scanRoute } from '../src/app/api/scan/route';
import { Tse2026QrAssembler } from '../src/lib/parser/tse2026/Tse2026QrAssembler';
import { Tse2026HashValidator } from '../src/lib/parser/tse2026/Tse2026HashValidator';

describe('TSE 2026 Turno 2 — Validação dos Exemplos Oficiais do TSE', () => {
  const baseDir = path.join(__dirname, 'fixtures/tse2026/turno2');

  const EXPECTED_FIXTURES: Record<string, { size: number; sha256: string }> = {
    'BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.dat': {
      size: 5829,
      sha256: '083dbcf02d00c3e8f63f1d1e8dc3f8dfba7cc342ee747fbca92d29b30e79311c'
    },
    'BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf': {
      size: 43941,
      sha256: '8467c318e7bbf26cf0c22a251b27f883518ca3ea2dec330e671819b1dcf3ef4f'
    },
    'BU_T2_VOTA_Presidente_Governador/PresGov-T2_s02200ac0139200090013-imgbu.dat': {
      size: 6895,
      sha256: 'ce3131508af46efa6dbe449339fa0dd868a5281803446d4364600887cf93477f'
    },
    'BU_T2_VOTA_Presidente_Governador/PresGov-T2_s02200ac0139200090013-imgbu.pdf': {
      size: 44905,
      sha256: '3f418e131d3682413923926bc434e7d5463254a6fa1d4ad84e622b129ea55e9b'
    },
    'BU_T2_VOTA_Presidente_Governador_ConsultaPopular/PresGovConMunic-T2_s02120ac0139200090013-imgbu.dat': {
      size: 7683,
      sha256: '4db34a3feda8fda1d0243f1d4d4b2eda5eaa8c30f326e86585d33247cc16ab6a'
    },
    'BU_T2_VOTA_Presidente_Governador_ConsultaPopular/PresGovConMunic-T2_s02120ac0139200090013-imgbu.pdf': {
      size: 45816,
      sha256: 'a14f97d6a82d889a5c8f4c0d747c921b62753255862c26ef0883fc48705ddd7e'
    },
    'BU_T2_VOTA_Presidente_Governador_Prefeito/PresGovPrefeito-T2_s18153sp6665603020018-imgbu.dat': {
      size: 7605,
      sha256: '9f3b2f9765d9a1c85fe48f5a5a7999bfb0841676711725c56ddf16b69c8d5012'
    },
    'BU_T2_VOTA_Presidente_Governador_Prefeito/PresGovPrefeito-T2_s18153sp6665603020018-imgbu.pdf': {
      size: 45622,
      sha256: 'ade2c7660bf3b6ff0be5d62c9e350e389d72045a997bf30cf6ca1143e5b0a19a'
    }
  };

  let operatorId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Operador Teste TSE',
        email: `op-tse-${Date.now()}@teste.local`,
        passwordHash: 'hash',
        role: 'ADMIN'
      }
    });
    operatorId = user.id;
  });

  it('1. Todos os 8 arquivos oficiais do TSE devem estar presentes com tamanho e SHA-256 íntegros', () => {
    for (const [relPath, expected] of Object.entries(EXPECTED_FIXTURES)) {
      const fullPath = path.join(baseDir, relPath);
      expect(fs.existsSync(fullPath), `Arquivo ausente: ${relPath}`).toBe(true);

      const stat = fs.statSync(fullPath);
      expect(stat.size, `Tamanho incorreto para: ${relPath}`).toBe(expected.size);

      const buf = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      expect(sha256, `SHA-256 divergente para: ${relPath}`).toBe(expected.sha256);
    }
  });

  it('2. Exemplo Pres-T2: Integridade SHA-512 dos dados QRBU simulados pelo TSE', () => {
    // Carrega o payload QRBU correspondente ao arquivo Pres-T2_s02202ac...
    const decodedFile = path.join(
      __dirname,
      'fixtures/tse-2026/official/examples/Pres-T2_s02202ac0139200090013-imgbu/decoded/qrbu-01-of-01.txt'
    );
    expect(fs.existsSync(decodedFile)).toBe(true);

    const content = fs.readFileSync(decodedFile, 'utf8').trim();
    expect(content).toContain('PLEI:2202');
    expect(content).toContain('TURN:2');
    expect(content).toContain('FASE:S'); // Oficialmente simulado pelo TSE
    expect(content).toContain('DTPL:20261025'); // Data oficial do 2º turno
    expect(content).toContain('CARG:1'); // Cargo Presidente

    const assembler = new Tse2026QrAssembler();
    const reconstructed = assembler.reconstruct([content]);
    expect(typeof reconstructed).toBe('string');

    const matchHash = content.match(/HASH:([A-Fa-f0-9]+)/);
    expect(matchHash).not.toBeNull();

    const validator = new Tse2026HashValidator();
    const validation = validator.validate(reconstructed as string, matchHash![1], [content]);
    expect(validation).toBe('VERIFIED');
  });

  it('3. Regra de Produção: Scanner rejeita rigorosamente FASE:S em operação real', async () => {
    // Operador autenticado
    vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
      authenticated: true,
      user: { userId: operatorId, role: 'ADMIN' }
    }));

    const decodedFile = path.join(
      __dirname,
      'fixtures/tse-2026/official/examples/Pres-T2_s02202ac0139200090013-imgbu/decoded/qrbu-01-of-01.txt'
    );
    const content = fs.readFileSync(decodedFile, 'utf8').trim();

    // Envia o BU oficial do TSE com FASE:S sem flag de simulação
    const res = await scanRoute(new Request('http://localhost/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        sessionId: 'session-tse-simulado-' + Date.now(),
        isSimulation: false // Operação real
      })
    }));

    // Em operação real, o sistema DEVE rejeitar com HTTP 400
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('SIMULATED_QRBU_REJECTED');
  });
});

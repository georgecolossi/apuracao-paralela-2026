import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Garante que qualquer execução de testes E2E utilize exclusivamente o banco isolado `e2e.db`,
 * falhando de forma fechada caso `DATABASE_URL` aponte para `dev.db`, `prod.db` ou outro alvo.
 */
export function assertE2EDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url !== 'file:./e2e.db') {
    throw new Error(
      `[E2E_ISOLATION_ERROR] DATABASE_URL deve ser exatamente "file:./e2e.db" nos processos E2E, mas recebeu "${url ?? 'undefined'}".`
    );
  }
  return url;
}

/**
 * Instancia PrismaClient estritamente vinculado ao banco isolado `file:./e2e.db`.
 */
export async function createE2EPrismaClient(): Promise<PrismaClient> {
  assertE2EDatabaseUrl();
  const { PrismaClient: PrismaClientCtor } = await import('@prisma/client');
  return new PrismaClientCtor({
    datasources: {
      db: {
        url: 'file:./e2e.db'
      }
    }
  });
}

/**
 * Calcula o digest SHA-512 hexadecimal em maiúsculas conforme o algoritmo oficial do TSE
 * implementado em `Tse2026HashValidator`.
 */
export function computeTseQrbuSha512(rawParts: string[]): string {
  const sortedParts = [...rawParts].sort((a, b) => {
    const idxA = Number.parseInt(a.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
    const idxB = Number.parseInt(b.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
    return idxA - idxB;
  });

  const processedParts = sortedParts.map((part, index) => {
    let processed = part.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '');
    if (index === sortedParts.length - 1) {
      const hashIdx = processed.indexOf(' HASH:');
      if (hashIdx !== -1) {
        processed = processed.substring(0, hashIdx);
      }
    }
    return processed;
  });

  return crypto.createHash('sha512').update(processedParts.join(' '), 'utf8').digest('hex').toUpperCase();
}

/**
 * Assina um payload QRBU único com o campo `HASH:` válido segundo `Tse2026HashValidator`.
 */
export function signSinglePartQrbu(bodyWithoutHashPrefix: string, suffixAfterHash = ''): string {
  const unsignedPart = `QRBU:1:1 ${bodyWithoutHashPrefix.trim()}`;
  const hash = computeTseQrbuSha512([unsignedPart]);
  const suffix = suffixAfterHash ? ` ${suffixAfterHash.trim()}` : '';
  return `${unsignedPart} HASH:${hash}${suffix}`;
}

/**
 * Converte partes QRBU (ex: fixtures `FASE:S` publicadas pelo TSE) para `FASE:O` em memória
 * recalculando o SHA-512 válido correspondente sem modificar arquivos em disco.
 */
export function convertQrbuPartsToOfficialPhaseO(rawParts: string[]): string[] {
  const updated = rawParts.map((part) => part.replace(/\bFASE:[ST]\b/, 'FASE:O'));
  const sortedIndices = updated
    .map((part, idx) => ({
      idx,
      partNum: Number.parseInt(part.match(/^QRBU:(\d+):/)?.[1] || '0', 10)
    }))
    .sort((a, b) => a.partNum - b.partNum);

  const lastOriginalIdx = sortedIndices[sortedIndices.length - 1]?.idx ?? updated.length - 1;
  const computedHash = computeTseQrbuSha512(updated);
  updated[lastOriginalIdx] = updated[lastOriginalIdx].replace(/\bHASH:[0-9A-Fa-f]+\b/, `HASH:${computedHash}`);
  return updated;
}

/**
 * Fixture QRBU oficial válida (`FASE:O`, VRQR 6.0, TURN:2, PLEI:2202, MUNI:1392)
 * com SHA-512 válido gerado pelo algoritmo canônico do TSE.
 */
export const OFFICIAL_PHASE_O_PRES_T2_PAYLOAD = signSinglePartQrbu(
  'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:2202 TURN:2 FASE:O UNFE:AC MUNI:1392 ZONA:9 SECA:13 AGRE:14.15 IDUE:2250280 IDCA:146113540341669047216787 HIQT:1 HICA:1:146113540341669047216787 VERS:10.20.0.0 LOCA:15 APTO:26 APTS:26 APTT:0 COMP:4 FALT:22 HBBM:3 HBBG:1 HBSB:0 DTAB:20261025 HRAB:171506 DTFC:20261025 HRFC:171951 IDEL:2212 CARG:1 TIPO:0 VERC:202608131512 92:2 APTA:26 APTS:26 APTT:0 NOMI:2 BRAN:1 NULO:1 TOTC:4'
);

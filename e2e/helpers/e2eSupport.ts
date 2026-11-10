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
 * Calcula o digest SHA-512 hexadecimal em maiúsculas conforme o algoritmo de integridade de conteúdo
 * do QRBU implementado em `Tse2026HashValidator` (não envolve assinatura digital assimétrica).
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
 * Gera um payload sintético de teste em formato QRBU único e recalcula o campo `HASH:` (SHA-512).
 * Valida apenas a integridade estrutural e de conteúdo via SHA-512; não cria nem valida assinatura digital oficial.
 */
export function buildPhaseOPayloadWithValidHash(
  bodyWithoutHashPrefix: string,
  suffixAfterHash = ''
): string {
  const unsignedPart = `QRBU:1:1 ${bodyWithoutHashPrefix.trim()}`;
  const hash = computeTseQrbuSha512([unsignedPart]);
  const suffix = suffixAfterHash ? ` ${suffixAfterHash.trim()}` : '';
  return `${unsignedPart} HASH:${hash}${suffix}`;
}

/**
 * Gera em memória variantes sintéticas de teste em formato QRBU FASE:O com SHA-512 recalculado
 * a partir de partes existentes (sem alterar os arquivos originais FASE:S do TSE em disco).
 * Não representa um BU genuinamente emitido pelo TSE nem assinatura digital oficial.
 */
export function buildSyntheticPhaseOPartsWithValidHash(rawParts: string[]): string[] {
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
 * Payload sintético de teste em formato QRBU FASE:O, com SHA-512 válido.
 * Não corresponde a um BU genuinamente emitido pelo TSE e não representa uma assinatura digital oficial.
 */
export const SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD = buildPhaseOPayloadWithValidHash(
  'VRQR:6.0 ORIG:VOTA ORLC:LEG PROC:2002 DTPL:20261025 PLEI:2202 TURN:2 FASE:O UNFE:AC MUNI:1392 ZONA:9 SECA:13 AGRE:14.15 IDUE:2250280 IDCA:146113540341669047216787 HIQT:1 HICA:1:146113540341669047216787 VERS:10.20.0.0 LOCA:15 APTO:26 APTS:26 APTT:0 COMP:4 FALT:22 HBBM:3 HBBG:1 HBSB:0 DTAB:20261025 HRAB:171506 DTFC:20261025 HRFC:171951 IDEL:2212 CARG:1 TIPO:0 VERC:202608131512 92:2 APTA:26 APTS:26 APTT:0 NOMI:2 BRAN:1 NULO:1 TOTC:4'
);

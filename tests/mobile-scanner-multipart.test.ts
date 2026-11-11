import { describe, it, expect } from 'vitest';
import { MultipartTracker } from '../src/lib/scanner/multipartState';

describe('PR 5 — Mobile Scanner: Gerenciamento de Estado Multipartes', () => {
  it('1. BU de Parte Única (totalParts = 1)', () => {
    const tracker = new MultipartTracker();
    const result = tracker.registerPart(1, 1);

    expect(result.success).toBe(true);
    expect(result.isDuplicate).toBe(false);
    expect(result.progress.totalParts).toBe(1);
    expect(result.progress.readCount).toBe(1);
    expect(result.progress.allPartsCaptured).toBe(true);
    expect(result.progress.isComplete).toBe(true);
    expect(result.progress.backendConfirmed).toBe(false);
    expect(result.progress.missingIndices).toEqual([]);
    expect(result.progress.statusMessage).toContain('Parte Única');

    tracker.confirmBackendSuccess();
    expect(tracker.getProgress().backendConfirmed).toBe(true);
    expect(tracker.getProgress().statusMessage).toContain('Confirmado pelo Servidor');
  });

  it('2. BU Multipartes em Ordem (Parte 1 e depois Parte 2)', () => {
    const tracker = new MultipartTracker();

    // Leitura da Parte 1
    const res1 = tracker.registerPart(1, 2);
    expect(res1.success).toBe(true);
    expect(res1.isDuplicate).toBe(false);
    expect(res1.progress.isComplete).toBe(false);
    expect(res1.progress.allPartsCaptured).toBe(false);
    expect(res1.progress.readCount).toBe(1);
    expect(res1.progress.receivedIndices).toEqual([1]);
    expect(res1.progress.missingIndices).toEqual([2]);
    expect(res1.progress.statusMessage).toContain('Parte 1 de 2 capturada');
    expect(res1.progress.statusMessage).toContain('Falta apenas a Parte 2');

    // Leitura da Parte 2
    const res2 = tracker.registerPart(2, 2);
    expect(res2.success).toBe(true);
    expect(res2.isDuplicate).toBe(false);
    expect(res2.progress.allPartsCaptured).toBe(true);
    expect(res2.progress.isComplete).toBe(true);
    expect(res2.progress.backendConfirmed).toBe(false);
    expect(res2.progress.readCount).toBe(2);
    expect(res2.progress.receivedIndices).toEqual([1, 2]);
    expect(res2.progress.missingIndices).toEqual([]);
    expect(res2.progress.statusMessage).toContain('Todas as 2 partes foram lidas');

    // Backend confirmação
    tracker.confirmBackendSuccess();
    expect(tracker.getProgress().backendConfirmed).toBe(true);
    expect(tracker.getProgress().statusMessage).toContain('confirmadas e processadas pelo servidor');
  });

  it('3. BU Multipartes Fora de Ordem (Parte 2 lida antes da Parte 1)', () => {
    const tracker = new MultipartTracker();

    // Parte 2 chega primeiro
    const res1 = tracker.registerPart(2, 2);
    expect(res1.success).toBe(true);
    expect(res1.isDuplicate).toBe(false);
    expect(res1.progress.isComplete).toBe(false);
    expect(res1.progress.receivedIndices).toEqual([2]);
    expect(res1.progress.missingIndices).toEqual([1]);
    expect(res1.progress.statusMessage).toContain('Parte 2 de 2 capturada');
    expect(res1.progress.statusMessage).toContain('Falta apenas a Parte 1');

    // Parte 1 chega em seguida
    const res2 = tracker.registerPart(1, 2);
    expect(res2.success).toBe(true);
    expect(res2.isDuplicate).toBe(false);
    expect(res2.progress.isComplete).toBe(true);
    expect(res2.progress.receivedIndices).toEqual([1, 2]);
    expect(res2.progress.missingIndices).toEqual([]);
    expect(res2.progress.statusMessage).toContain('Todas as 2 partes foram lidas');
  });

  it('4. Detecção de Parte Duplicada na Mesma Sessão', () => {
    const tracker = new MultipartTracker();

    tracker.registerPart(1, 2);
    const dupRes = tracker.registerPart(1, 2);

    expect(dupRes.success).toBe(true);
    expect(dupRes.isDuplicate).toBe(true);
    expect(dupRes.progress.readCount).toBe(1);
    expect(dupRes.progress.isComplete).toBe(false);
    expect(dupRes.progress.missingIndices).toEqual([2]);
  });

  it('5. Sequência complexa com 4 partes lidas fora de ordem (1 -> 3 -> 4 -> 2)', () => {
    const tracker = new MultipartTracker();

    tracker.registerPart(1, 4);
    expect(tracker.getProgress().missingIndices).toEqual([2, 3, 4]);

    tracker.registerPart(3, 4);
    expect(tracker.getProgress().missingIndices).toEqual([2, 4]);
    expect(tracker.getProgress().statusMessage).toContain('Faltam as partes: 2, 4');

    tracker.registerPart(4, 4);
    expect(tracker.getProgress().missingIndices).toEqual([2]);
    expect(tracker.getProgress().statusMessage).toContain('Falta apenas a Parte 2');

    tracker.registerPart(2, 4);
    expect(tracker.getProgress().isComplete).toBe(true);
    expect(tracker.getProgress().missingIndices).toEqual([]);
  });

  it('6. Reset de Sessão Limpa Todo o Histórico de Reconstrução', () => {
    const tracker = new MultipartTracker();
    tracker.registerPart(1, 3, 'ENV-1');
    tracker.registerPart(2, 3, 'ENV-1');
    tracker.confirmBackendSuccess();
    expect(tracker.getProgress().readCount).toBe(2);
    expect(tracker.getProgress().backendConfirmed).toBe(true);
    expect(tracker.getEnvelopeKey()).toBe('ENV-1');

    tracker.reset();
    expect(tracker.getProgress().readCount).toBe(0);
    expect(tracker.getProgress().isComplete).toBe(false);
    expect(tracker.getProgress().backendConfirmed).toBe(false);
    expect(tracker.getEnvelopeKey()).toBeNull();
    expect(tracker.hasPart(1)).toBe(false);
    expect(tracker.hasPart(2)).toBe(false);
  });

  it('7. Rejeição de Métricas Numéricas Inválidas (Zero, Negativo, Fracionário, >30)', () => {
    const tracker = new MultipartTracker();

    // Parte ou total <= 0
    const resZero = tracker.registerPart(0, 2);
    expect(resZero.success).toBe(false);
    expect(resZero.errorCode).toBe('INVALID_PART_METRICS');

    const resNeg = tracker.registerPart(-1, 2);
    expect(resNeg.success).toBe(false);
    expect(resNeg.errorCode).toBe('INVALID_PART_METRICS');

    // Total zero
    const resTotalZero = tracker.registerPart(1, 0);
    expect(resTotalZero.success).toBe(false);
    expect(resTotalZero.errorCode).toBe('INVALID_PART_METRICS');

    // Fracionário
    const resFloat = tracker.registerPart(1.5, 3);
    expect(resFloat.success).toBe(false);
    expect(resFloat.errorCode).toBe('INVALID_PART_METRICS');

    // Total excessivo (> 30)
    const resHuge = tracker.registerPart(1, 99);
    expect(resHuge.success).toBe(false);
    expect(resHuge.errorCode).toBe('INVALID_PART_METRICS');
  });

  it('8. Rejeição de Índice de Parte Superior ao Total Previsto', () => {
    const tracker = new MultipartTracker();
    const res = tracker.registerPart(3, 2);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('INVALID_PART_INDEX');
    expect(res.errorMessage).toContain('excede o total previsto');
  });

  it('9. Rejeição de TotalParts Divergente Dentro de uma Mesma Sequência', () => {
    const tracker = new MultipartTracker();

    // Começa com totalParts = 3
    const res1 = tracker.registerPart(1, 3);
    expect(res1.success).toBe(true);

    // Tenta registrar parte informando totalParts = 4
    const res2 = tracker.registerPart(2, 4);
    expect(res2.success).toBe(false);
    expect(res2.errorCode).toBe('MISMATCHED_TOTAL_PARTS');
    expect(res2.errorMessage).toContain('diverge da sequência iniciada');

    // Tracker deve preservar o estado original intacto
    expect(tracker.getProgress().totalParts).toBe(3);
    expect(tracker.getProgress().readCount).toBe(1);
    expect(tracker.hasPart(1)).toBe(true);
    expect(tracker.hasPart(2)).toBe(false);
  });

  it('10. Rejeição de Envelopes Misturados (Fragmentos de BUs Distintos)', () => {
    const tracker = new MultipartTracker();

    const envA = 'PLEI-1392-0001-0001';
    const envB = 'PLEI-1392-0001-0002';

    // Parte 1 do envelope A
    const res1 = tracker.registerPart(1, 2, envA);
    expect(res1.success).toBe(true);
    expect(tracker.getEnvelopeKey()).toBe(envA);

    // Tentativa de registrar Parte 2 vinda do envelope B
    const res2 = tracker.registerPart(2, 2, envB);
    expect(res2.success).toBe(false);
    expect(res2.errorCode).toBe('BALLOT_ENVELOPE_MISMATCH');
    expect(res2.errorMessage).toContain('outro boletim');

    // Parte 2 do envelope A legítimo deve ser aceita
    const res3 = tracker.registerPart(2, 2, envA);
    expect(res3.success).toBe(true);
    expect(tracker.getProgress().allPartsCaptured).toBe(true);
  });
});

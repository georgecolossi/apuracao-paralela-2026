import { describe, it, expect } from 'vitest';
import { MultipartTracker } from '../src/lib/scanner/multipartState';

describe('PR 5 — Mobile Scanner: Gerenciamento de Estado Multipartes', () => {
  it('1. BU de Parte Única (totalParts = 1)', () => {
    const tracker = new MultipartTracker();
    const result = tracker.registerPart(1, 1);

    expect(result.isDuplicate).toBe(false);
    expect(result.progress.totalParts).toBe(1);
    expect(result.progress.readCount).toBe(1);
    expect(result.progress.isComplete).toBe(true);
    expect(result.progress.missingIndices).toEqual([]);
    expect(result.progress.statusMessage).toContain('Parte Única');
  });

  it('2. BU Multipartes em Ordem (Parte 1 e depois Parte 2)', () => {
    const tracker = new MultipartTracker();

    // Leitura da Parte 1
    const res1 = tracker.registerPart(1, 2);
    expect(res1.isDuplicate).toBe(false);
    expect(res1.progress.isComplete).toBe(false);
    expect(res1.progress.readCount).toBe(1);
    expect(res1.progress.receivedIndices).toEqual([1]);
    expect(res1.progress.missingIndices).toEqual([2]);
    expect(res1.progress.statusMessage).toContain('Parte 1 de 2 capturada');
    expect(res1.progress.statusMessage).toContain('Falta apenas a Parte 2');

    // Leitura da Parte 2
    const res2 = tracker.registerPart(2, 2);
    expect(res2.isDuplicate).toBe(false);
    expect(res2.progress.isComplete).toBe(true);
    expect(res2.progress.readCount).toBe(2);
    expect(res2.progress.receivedIndices).toEqual([1, 2]);
    expect(res2.progress.missingIndices).toEqual([]);
    expect(res2.progress.statusMessage).toContain('Todas as 2 partes foram lidas');
  });

  it('3. BU Multipartes Fora de Ordem (Parte 2 lida antes da Parte 1)', () => {
    const tracker = new MultipartTracker();

    // Parte 2 chega primeiro
    const res1 = tracker.registerPart(2, 2);
    expect(res1.isDuplicate).toBe(false);
    expect(res1.progress.isComplete).toBe(false);
    expect(res1.progress.receivedIndices).toEqual([2]);
    expect(res1.progress.missingIndices).toEqual([1]);
    expect(res1.progress.statusMessage).toContain('Parte 2 de 2 capturada');
    expect(res1.progress.statusMessage).toContain('Falta apenas a Parte 1');

    // Parte 1 chega em seguida
    const res2 = tracker.registerPart(1, 2);
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
    tracker.registerPart(1, 3);
    tracker.registerPart(2, 3);
    expect(tracker.getProgress().readCount).toBe(2);

    tracker.reset();
    expect(tracker.getProgress().readCount).toBe(0);
    expect(tracker.getProgress().isComplete).toBe(false);
    expect(tracker.hasPart(1)).toBe(false);
    expect(tracker.hasPart(2)).toBe(false);
  });
});

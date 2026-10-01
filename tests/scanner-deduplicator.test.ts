import { describe, it, expect } from 'vitest';
import { ScannerDeduplicator } from '../src/lib/scanner-deduplicator';

describe('ScannerDeduplicator', () => {
  it('1. MESMO CONTEÚDO REPETIDO', () => {
    const dedup = new ScannerDeduplicator();
    expect(dedup.shouldProcess('A')).toBe(true);
    expect(dedup.shouldProcess('A')).toBe(false);
    expect(dedup.shouldProcess('A')).toBe(false);
  });

  it('2. CONTEÚDO MUDA', () => {
    const dedup = new ScannerDeduplicator();
    expect(dedup.shouldProcess('A')).toBe(true);
    expect(dedup.shouldProcess('A')).toBe(false);
    expect(dedup.shouldProcess('B')).toBe(true);
    expect(dedup.shouldProcess('B')).toBe(false);
  });

  it('3. FORA DE ORDEM', () => {
    const dedup = new ScannerDeduplicator();
    expect(dedup.shouldProcess('C')).toBe(true);
    expect(dedup.shouldProcess('A')).toBe(true);
    expect(dedup.shouldProcess('D')).toBe(true);
    expect(dedup.shouldProcess('B')).toBe(true);
  });

  it('4. RELEITURA POSTERIOR', () => {
    const dedup = new ScannerDeduplicator();
    expect(dedup.shouldProcess('A')).toBe(true);
    expect(dedup.shouldProcess('B')).toBe(true);
    expect(dedup.shouldProcess('A')).toBe(true);
  });

  it('5. CALLBACKS RÁPIDOS (Concorrência síncrona)', () => {
    const dedup = new ScannerDeduplicator();
    
    // Simula três callbacks do componente React em lote antes de qualquer promessa retornar
    const results = [
      dedup.shouldProcess('A'),
      dedup.shouldProcess('A'),
      dedup.shouldProcess('A')
    ];

    expect(results).toEqual([true, false, false]);
  });

  it('Limpeza intencional (ex: erro de rede)', () => {
    const dedup = new ScannerDeduplicator();
    expect(dedup.shouldProcess('A')).toBe(true);
    dedup.clearIfMatches('A');
    expect(dedup.shouldProcess('A')).toBe(true); // Pode ser relido imediatamente
  });
});

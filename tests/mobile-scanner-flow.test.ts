import { describe, it, expect } from 'vitest';
import { formatScanError } from '../src/lib/scanner/qrbuErrorHandler';
import { ScannerDeduplicator } from '../src/lib/scanner-deduplicator';

describe('PR 5 — Mobile Scanner: Fluxo de Tratamento de Erros e Concorrência', () => {
  describe('1. Mapeamento de Erros e Fail-Closed', () => {
    it('1.1 401 Não Autorizado / Sessão Expirada', () => {
      const err = formatScanError(401);
      expect(err.title).toBe('Sessão Expirada');
      expect(err.isRetryable).toBe(false);
    });

    it('1.2 403 Perfil VIEWER Sem Permissão de Escrita', () => {
      const err = formatScanError(403, { error: 'FORBIDDEN_ROLE', message: 'Acesso negado: VIEWER' });
      expect(err.title).toBe('Acesso Não Autorizado');
      expect(err.message).toContain('visualizador (VIEWER)');
      expect(err.isRetryable).toBe(false);
    });

    it('1.3 403 Falha de Origem / CSRF', () => {
      const err = formatScanError(403, { error: 'Falha na validação de origem (CSRF)' });
      expect(err.title).toBe('Falha de Segurança (CSRF)');
      expect(err.isRetryable).toBe(true);
    });

    it('1.4 422 Integridade Criptográfica SHA-512 Violada', () => {
      const err = formatScanError(422, { error: 'CRYPTOGRAPHIC_INTEGRITY_FAILED' });
      expect(err.title).toBe('Integridade Criptográfica Violada');
      expect(err.message).toContain('SHA-512');
      expect(err.isRetryable).toBe(true);
    });

    it('1.5 422 Boletim Duplicado', () => {
      const err = formatScanError(422, { error: 'DUPLICATED_BALLOT' });
      expect(err.title).toBe('Boletim Já Processado');
      expect(err.isRetryable).toBe(false);
    });

    it('1.6 422 Seção Fora de Cobertura', () => {
      const err = formatScanError(422, { error: 'OUT_OF_COVERAGE' });
      expect(err.title).toBe('Seção Fora de Cobertura');
      expect(err.isRetryable).toBe(false);
    });

    it('1.7 422 Cargo Não Configurado na Eleição Ativa', () => {
      const err = formatScanError(422, { error: 'OFFICE_NOT_CONFIGURED' });
      expect(err.title).toBe('Cargo Não Configurado');
      expect(err.isRetryable).toBe(false);
    });

    it('1.8 422 Incompatibilidade Eleitoral (Ano/Pleito)', () => {
      const err = formatScanError(422, { error: 'ELECTION_MISMATCH' });
      expect(err.title).toBe('Eleição Incompatível');
      expect(err.isRetryable).toBe(false);
    });

    it('1.9 400 Layout VRQR Não Suportado', () => {
      const err = formatScanError(400, { error: 'UNSUPPORTED_VRQR_VERSION' });
      expect(err.title).toBe('Versão Não Suportada');
      expect(err.isRetryable).toBe(false);
    });

    it('1.10 400 Layout VRQR Experimental Não Homologado', () => {
      const err = formatScanError(400, { error: 'UNHOMOLOGATED_VRQR_VERSION' });
      expect(err.title).toBe('Layout Não Homologado');
      expect(err.isRetryable).toBe(false);
    });

    it('1.11 400 Envelope Corrompido / Tokens Fora de Posição', () => {
      const err = formatScanError(400, { error: 'DISPLACED_VOTE_TOKEN' });
      expect(err.title).toBe('Formato de Envelope Inválido');
      expect(err.isRetryable).toBe(true);
    });

    it('1.12 400 Resumo Incompleto', () => {
      const err = formatScanError(400, { error: 'INCOMPLETE_SUMMARY_BLOCK' });
      expect(err.title).toBe('Envelope Incompleto');
      expect(err.isRetryable).toBe(true);
    });

    it('1.13 400 Divergência Aritmética de Totais', () => {
      const err = formatScanError(400, { error: 'SUMMARY_TOTAL_MISMATCH' });
      expect(err.title).toBe('Divergência Aritmética');
      expect(err.isRetryable).toBe(true);
    });

    it('1.14 400 Cabeçalho Não Reconhecido', () => {
      const err = formatScanError(400, { error: 'INVALID_HEADER' });
      expect(err.title).toBe('Cabeçalho Inválido');
      expect(err.isRetryable).toBe(true);
    });
  });

  describe('2. Deduplicação e Prevenção de Envios Concorrentes por Frames da Câmera', () => {
    it('2.1 Rejeita frames idênticos consecutivos do sensor de vídeo', () => {
      const dedup = new ScannerDeduplicator();
      const qrFrame = 'QRBU:1:1:1:1:SC:80837:90:1:HASH...';

      expect(dedup.shouldProcess(qrFrame)).toBe(true);
      // Próximos 15 frames com o mesmo QR Code são descartados sem nova requisição HTTP
      for (let i = 0; i < 15; i++) {
        expect(dedup.shouldProcess(qrFrame)).toBe(false);
      }
    });

    it('2.2 Permite processar próxima parte diferente (Parte 2)', () => {
      const dedup = new ScannerDeduplicator();
      const part1 = 'QRBU:1:1:1:2:SC:80837:90:1:PARTE1';
      const part2 = 'QRBU:1:1:2:2:SC:80837:90:1:PARTE2';

      expect(dedup.shouldProcess(part1)).toBe(true);
      expect(dedup.shouldProcess(part1)).toBe(false);
      expect(dedup.shouldProcess(part2)).toBe(true);
      expect(dedup.shouldProcess(part2)).toBe(false);
    });

    it('2.3 Limpeza de deduplicador permite releitura após erro tratável', () => {
      const dedup = new ScannerDeduplicator();
      const qrCode = 'QRBU:1:1:1:1:SC:80837:90:1:CORRUPTED';

      expect(dedup.shouldProcess(qrCode)).toBe(true);
      expect(dedup.shouldProcess(qrCode)).toBe(false);

      // Em erro de rede ou erro transitório, clearIfMatches permite nova tentativa
      dedup.clearIfMatches(qrCode);
      expect(dedup.shouldProcess(qrCode)).toBe(true);
    });
  });
});

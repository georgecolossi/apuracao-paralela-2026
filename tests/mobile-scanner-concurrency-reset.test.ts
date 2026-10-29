import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultipartTracker } from '../src/lib/scanner/multipartState';

/**
 * Harness que encapsula os mecanismos de concorrência, cancelamento com AbortController,
 * rastreamento de gerações monotônicas e refs anti-stale-closures implementados em
 * src/app/admin/scanner/page.tsx.
 */
class ScannerPageControllerHarness {
  public sessionIdRef = { current: '' };
  public csrfTokenRef = { current: '' };
  public generationIdRef = { current: 0 };
  public activeAbortControllerRef = { current: null as AbortController | null };
  public isProcessingRef = { current: false };

  public deduplicator = {
    lastScanned: null as string | null,
    shouldProcess: vi.fn(function(this: any, content?: string) {
      if (!content || this.lastScanned === content) return false;
      this.lastScanned = content;
      return true;
    }),
    clearIfMatches: vi.fn(function(this: any, content: string) {
      if (this.lastScanned === content) {
        this.lastScanned = null;
      }
    }),
    clear: vi.fn(function(this: any) {
      this.lastScanned = null;
    })
  };

  public multipartTracker = new MultipartTracker();
  public executedRedirects: string[] = [];
  public errorMessages: string[] = [];
  public statusMessages: string[] = [];
  public outboundRequests: Array<{
    sessionId: string;
    csrfToken: string;
    generation: number;
    content: string;
  }> = [];

  constructor() {
    this.generateNewSession();
  }

  public generateNewSession(): string {
    this.generationIdRef.current += 1;

    if (this.activeAbortControllerRef.current) {
      try {
        this.activeAbortControllerRef.current.abort();
      } catch {
        // ignore
      }
      this.activeAbortControllerRef.current = null;
    }

    const newSession = `SCAN-MOB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    this.sessionIdRef.current = newSession;
    this.deduplicator.clear();
    this.multipartTracker.reset();
    this.isProcessingRef.current = false;

    return newSession;
  }

  public async ensureCsrfToken(fetchMock?: () => Promise<string>): Promise<string | null> {
    if (this.csrfTokenRef.current) {
      return this.csrfTokenRef.current;
    }
    if (fetchMock) {
      try {
        const token = await fetchMock();
        if (token) {
          this.csrfTokenRef.current = token;
          return token;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * Simula a execução de processQrContent idêntica à do componente React.
   */
  public async processQrContent(
    rawText: string,
    fetchBackend: (req: {
      content: string;
      sessionId: string;
      csrfToken: string;
      signal: AbortSignal;
    }) => Promise<any>,
    csrfResolver?: () => Promise<string>
  ): Promise<boolean> {
    // 1. Concorrência mútua estrita síncrona
    if (this.isProcessingRef.current) {
      return false;
    }

    const trimmed = (rawText || '').trim();
    if (!trimmed.startsWith('QRBU:')) {
      return false;
    }

    // 2. Captura SÍNCRONA de sessão e geração ANTES de qualquer await
    const reqSessionId = this.sessionIdRef.current;
    const reqGeneration = this.generationIdRef.current;
    if (!reqSessionId) {
      this.statusMessages.push('Aguardando inicialização da sessão...');
      return false;
    }

    // 3. Deduplicação preliminar
    if (!this.deduplicator.shouldProcess(trimmed)) {
      return false;
    }

    // 4. Adquire a trava de processamento de forma SÍNCRONA, antes de ensureCsrfToken()
    this.isProcessingRef.current = true;
    let abortController: AbortController | null = null;

    try {
      // 5. Obtém ou aguarda token CSRF
      const currentCsrf = this.csrfTokenRef.current || (await this.ensureCsrfToken(csrfResolver));

      // 6. Confirmação pós-await do CSRF: geração e sessão DEVEM ser as mesmas capturadas no início
      if (
        this.generationIdRef.current !== reqGeneration ||
        this.sessionIdRef.current !== reqSessionId
      ) {
        this.deduplicator.clearIfMatches(trimmed);
        return false;
      }

      // 7. Política Fail-Closed: se o token CSRF não pôde ser obtido
      if (!currentCsrf) {
        this.deduplicator.clearIfMatches(trimmed);
        this.errorMessages.push('Segurança CSRF');
        this.statusMessages.push('Aguardando credencial de segurança...');
        return false;
      }

      // 8. Despacho HTTP com AbortController
      abortController = new AbortController();
      this.activeAbortControllerRef.current = abortController;

      this.outboundRequests.push({
        sessionId: reqSessionId,
        csrfToken: currentCsrf,
        generation: reqGeneration,
        content: trimmed
      });

      const data = await fetchBackend({
        content: trimmed,
        sessionId: reqSessionId,
        csrfToken: currentCsrf,
        signal: abortController.signal
      });

      // Validação pós-fetch: geração deve ser rigorosamente a mesma
      if (
        this.generationIdRef.current !== reqGeneration ||
        this.sessionIdRef.current !== reqSessionId
      ) {
        return false;
      }

      if (data.status === 'COMPLETO') {
        this.multipartTracker.confirmBackendSuccess();
        this.executedRedirects.push(`/admin/conferir/${data.reportId}`);
        return true;
      } else if (data.status === 'PARCIAL') {
        const partIndex = data.partIndex || 1;
        const totalParts = data.totalParts || 2;
        const envelopeKey = data.envelopeKey || null;
        this.multipartTracker.registerPart(partIndex, totalParts, envelopeKey);
        return true;
      } else if (data.error) {
        this.errorMessages.push(data.error);
        return false;
      }
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
        return false;
      }
      if (
        this.generationIdRef.current !== reqGeneration ||
        this.sessionIdRef.current !== reqSessionId
      ) {
        return false;
      }
      this.deduplicator.clearIfMatches(trimmed);
      this.errorMessages.push('Falha de Conexão');
      return false;
    } finally {
      if (abortController && this.activeAbortControllerRef.current === abortController) {
        this.activeAbortControllerRef.current = null;
      }
      // O finally de uma operação abandonada JAMAIS libera a trava de outra geração
      if (this.generationIdRef.current === reqGeneration) {
        this.isProcessingRef.current = false;
      }
    }
  }
}

describe('PR 5 — Mobile Scanner: Concorrência, Gerações Monotônicas e Eliminação de Stale Closures', () => {
  let harness: ScannerPageControllerHarness;

  beforeEach(() => {
    harness = new ScannerPageControllerHarness();
  });

  describe('1. Eliminação de Stale Closures no Callback da Câmera', () => {
    it('1.1 Callback capturado previamente utiliza o sessionId vigente após reset', async () => {
      // Simula a obtenção de token CSRF inicial
      harness.csrfTokenRef.current = 'valid-csrf-token-abc';
      const initialSession = harness.sessionIdRef.current;

      // Simula callback registrado na biblioteca de câmera
      const cameraCallback = async (text: string) => {
        return harness.processQrContent(text, async (req) => {
          return { status: 'PARCIAL', partIndex: 1, totalParts: 2 };
        });
      };

      // Operador clica em Reset -> Sessão muda
      const newSession = harness.generateNewSession();
      expect(newSession).not.toBe(initialSession);
      expect(harness.sessionIdRef.current).toBe(newSession);

      // Câmera decodifica frame usando a closure original
      await cameraCallback('QRBU:mock-part-1');

      // A requisição de rede DEVE conter o novo sessionId vigente, nunca o inicial
      expect(harness.outboundRequests.length).toBe(1);
      expect(harness.outboundRequests[0].sessionId).toBe(newSession);
      expect(harness.outboundRequests[0].sessionId).not.toBe(initialSession);
    });

    it('1.2 Callback registrado antes de obter CSRF aguarda e utiliza token resolvido tardiamente', async () => {
      // Token inicial ausente
      harness.csrfTokenRef.current = '';

      let fetchCount = 0;
      const delayedCsrfFetcher = async () => {
        fetchCount++;
        return 'delayed-token-12345';
      };

      const result = await harness.processQrContent(
        'QRBU:payload-with-late-csrf',
        async (req) => ({ status: 'PARCIAL', partIndex: 1, totalParts: 2 }),
        delayedCsrfFetcher
      );

      expect(result).toBe(true);
      expect(fetchCount).toBe(1);
      expect(harness.csrfTokenRef.current).toBe('delayed-token-12345');
      expect(harness.outboundRequests[0].csrfToken).toBe('delayed-token-12345');
    });

    it('1.3 Bloqueia envio se CSRF token não puder ser obtido (Fail-Closed)', async () => {
      harness.csrfTokenRef.current = '';

      const failingCsrfFetcher = async () => {
        throw new Error('Network timeout fetching CSRF');
      };

      const result = await harness.processQrContent(
        'QRBU:payload-will-fail-csrf',
        async () => ({ status: 'COMPLETO', reportId: 'rep-fail' }),
        failingCsrfFetcher
      );

      expect(result).toBe(false);
      expect(harness.outboundRequests.length).toBe(0);
      expect(harness.errorMessages).toContain('Segurança CSRF');
      expect(harness.executedRedirects.length).toBe(0);
    });

    it('1.4 Reinício durante Promise de CSRF pendente: descarta requisição da geração antiga sem chamar backend, preserva nova sessão', async () => {
      let resolveDelayedCsrf!: (val: string) => void;
      const delayedCsrfPromise = new Promise<string>((resolve) => {
        resolveDelayedCsrf = resolve;
      });

      // Leitura na Geração 1 inicia com CSRF pendente
      const p1 = harness.processQrContent(
        'QRBU:payload-pending-csrf',
        async () => ({ status: 'COMPLETO', reportId: 'stale-1' }),
        () => delayedCsrfPromise
      );

      // Trava de processamento foi adquirida sincronamente antes do await
      expect(harness.isProcessingRef.current).toBe(true);

      // Operador clica em Reset: nova sessão e nova geração
      const newSession = harness.generateNewSession();
      expect(harness.generationIdRef.current).toBe(2);
      expect(harness.isProcessingRef.current).toBe(false);

      // Agora a promise de CSRF da Geração 1 finalmente resolve tardiamente
      resolveDelayedCsrf('resolved-token-late');
      const res1 = await p1;

      // Operação antiga foi descartada antes do despacho HTTP!
      expect(res1).toBe(false);
      expect(harness.outboundRequests.length).toBe(0);
      expect(harness.executedRedirects.length).toBe(0);

      // Nova leitura na Geração 2 agora ocorre com sucesso utilizando o token resolvido
      const res2 = await harness.processQrContent(
        'QRBU:payload-session-2',
        async () => ({ status: 'COMPLETO', reportId: 'valid-rep-gen2' })
      );

      expect(res2).toBe(true);
      expect(harness.outboundRequests.length).toBe(1);
      expect(harness.outboundRequests[0].sessionId).toBe(newSession);
      expect(harness.outboundRequests[0].csrfToken).toBe('resolved-token-late');
      expect(harness.executedRedirects).toEqual(['/admin/conferir/valid-rep-gen2']);
    });

    it('1.5 Falha inicial de CSRF limpa deduplicador e permite releitura imediata com sucesso do mesmo QR Code', async () => {
      // 1ª tentativa: endpoint de CSRF falha (ex: rede instável)
      const failingCsrf = async () => {
        throw new Error('CSRF fetch failed');
      };

      const res1 = await harness.processQrContent(
        'QRBU:same-qr-payload',
        async () => ({ status: 'COMPLETO', reportId: 'fail' }),
        failingCsrf
      );

      expect(res1).toBe(false);
      expect(harness.outboundRequests.length).toBe(0);
      expect(harness.errorMessages).toContain('Segurança CSRF');
      expect(harness.isProcessingRef.current).toBe(false);

      // Token CSRF é restabelecido
      harness.csrfTokenRef.current = 'token-recovered-ok';

      // 2ª tentativa: operador escaneia o EXATAMENTE MESMO QR Code
      const res2 = await harness.processQrContent(
        'QRBU:same-qr-payload',
        async () => ({ status: 'COMPLETO', reportId: 'recovered-rep-ok' })
      );

      // O deduplicador NÃO deve bloquear a releitura porque a tentativa anterior falhou antes do despacho HTTP
      expect(res2).toBe(true);
      expect(harness.outboundRequests.length).toBe(1);
      expect(harness.outboundRequests[0].content).toBe('QRBU:same-qr-payload');
      expect(harness.executedRedirects).toEqual(['/admin/conferir/recovered-rep-ok']);
    });
  });

  describe('2. Isolamento de Requisições em Voo e Cancelamento com AbortController', () => {
    it('2.1 Resposta tardia de requisição de sessão abandonada é ignorada sem redirecionamento', async () => {
      harness.csrfTokenRef.current = 'csrf-ok';

      let resolveSlowRequest!: (val: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolveSlowRequest = resolve;
      });

      // Dispara leitura na Sessão 1 (lenta)
      const p1 = harness.processQrContent('QRBU:slow-part-1', () => slowPromise);

      expect(harness.outboundRequests.length).toBe(1);
      expect(harness.isProcessingRef.current).toBe(true);

      // Enquanto requisição está em trânsito, operador reinicia sessão
      const session2 = harness.generateNewSession();
      expect(harness.generationIdRef.current).toBe(2);
      expect(harness.isProcessingRef.current).toBe(false);

      // Resposta tardia da Sessão 1 é concluída
      resolveSlowRequest({ status: 'COMPLETO', reportId: 'stale-report-999' });
      await p1;

      // NENHUM redirecionamento para relatório da sessão antiga pode ter sido emitido
      expect(harness.executedRedirects).toEqual([]);
      // Tracker da nova sessão permanece intacto e não confirmado
      expect(harness.multipartTracker.getProgress().backendConfirmed).toBe(false);
      expect(harness.multipartTracker.getProgress().readCount).toBe(0);
    });

    it('2.2 AbortController ativo da requisição anterior é cancelado no reset', async () => {
      harness.csrfTokenRef.current = 'csrf-ok';

      let receivedSignal!: AbortSignal;
      const p1 = harness.processQrContent('QRBU:hung-request', async ({ signal }) => {
        receivedSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      expect(receivedSignal.aborted).toBe(false);

      // Operador reseta a sessão
      harness.generateNewSession();

      // O sinal recebido pela requisição anterior DEVE ter sido abortado
      expect(receivedSignal.aborted).toBe(true);
      const res = await p1;
      expect(res).toBe(false); // Ignorado silenciosamente
    });

    it('2.3 Respostas fora de ordem entre gerações: apenas a geração vigente é aceita', async () => {
      harness.csrfTokenRef.current = 'csrf-ok';

      let resolveGen1!: (val: any) => void;
      const gen1Promise = new Promise((res) => {
        resolveGen1 = res;
      });

      // Geração 1 enviada
      const p1 = harness.processQrContent('QRBU:gen1', () => gen1Promise);

      // Reset para Geração 2
      harness.generateNewSession();

      // Geração 2 enviada e respondida rapidamente
      const p2 = harness.processQrContent('QRBU:gen2', async () => ({
        status: 'COMPLETO',
        reportId: 'valid-gen2-report'
      }));

      await p2;
      expect(harness.executedRedirects).toEqual(['/admin/conferir/valid-gen2-report']);
      expect(harness.multipartTracker.getProgress().backendConfirmed).toBe(true);

      // Geração 1 responde depois
      resolveGen1({ status: 'COMPLETO', reportId: 'stale-gen1-report' });
      await p1;

      // Não houve acréscimo de redirect da geração 1
      expect(harness.executedRedirects).toEqual(['/admin/conferir/valid-gen2-report']);
    });
  });

  describe('3. Concorrência Mútua entre Câmera, Foto e Manual', () => {
    it('3.1 Bloqueia submissão concorrente se processamento estiver em andamento', async () => {
      harness.csrfTokenRef.current = 'csrf-ok';

      let resolveOngoing!: (val: any) => void;
      const ongoingPromise = new Promise((res) => {
        resolveOngoing = res;
      });

      // Operação 1 (Câmera) inicia
      const p1 = harness.processQrContent('QRBU:camera-stream', () => ongoingPromise);
      expect(harness.isProcessingRef.current).toBe(true);

      // Operação 2 (Entrada Manual) tenta submeter enquanto a câmera está processando
      const manualAccepted = await harness.processQrContent('QRBU:manual-input', async () => ({
        status: 'COMPLETO',
        reportId: 'manual'
      }));

      expect(manualAccepted).toBe(false);
      expect(harness.outboundRequests.length).toBe(1);
      expect(harness.outboundRequests[0].content).toBe('QRBU:camera-stream');

      // Finaliza operação 1
      resolveOngoing({ status: 'COMPLETO', reportId: 'camera-report' });
      await p1;

      expect(harness.isProcessingRef.current).toBe(false);
    });

    it('3.2 Reset durante requisição não desbloqueia prematuramente a sessão antiga', async () => {
      harness.csrfTokenRef.current = 'csrf-ok';

      let resolveGen1!: (val: any) => void;
      const gen1Promise = new Promise((res) => {
        resolveGen1 = res;
      });

      // Inicia Geração 1
      const p1 = harness.processQrContent('QRBU:gen1', () => gen1Promise);
      expect(harness.isProcessingRef.current).toBe(true);

      // Reset para Geração 2 limpa a trava para a Geração 2
      harness.generateNewSession();
      expect(harness.isProcessingRef.current).toBe(false);

      // Inicia Geração 2
      let resolveGen2!: (val: any) => void;
      const gen2Promise = new Promise((res) => {
        resolveGen2 = res;
      });
      const p2 = harness.processQrContent('QRBU:gen2', () => gen2Promise);
      expect(harness.isProcessingRef.current).toBe(true);

      // Agora a Geração 1 antiga conclui seu bloco finally
      resolveGen1({ status: 'PARCIAL', partIndex: 1, totalParts: 2 });
      await p1;

      // A trava de processamento da GERAÇÃO 2 ainda deve estar ATIVA (não pode ser liberada pela geração 1)
      expect(harness.isProcessingRef.current).toBe(true);

      // Conclui Geração 2
      resolveGen2({ status: 'COMPLETO', reportId: 'rep2' });
      await p2;
      expect(harness.isProcessingRef.current).toBe(false);
    });
  });
});

// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ScannerMobilePage from '../src/app/admin/scanner/page';
import { Html5Qrcode } from 'html5-qrcode';

// Configura o ambiente para suportar act(...) do React 19 sem warnings
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock de next/navigation
const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush
  })
}));

describe('PR 5 — Mobile Scanner: Teste com Componente React Real Montado', () => {
  let container: HTMLDivElement;
  let root: Root;
  let cameraScanCallback: ((decodedText: string) => void) | null = null;
  let startCalledPromiseResolve: (() => void) | null = null;
  let startCalledPromise: Promise<void>;

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockRouterPush.mockClear();
    cameraScanCallback = null;
    startCalledPromise = new Promise((resolve) => {
      startCalledPromiseResolve = resolve;
    });

    // Mock das capacidades da câmera e biblioteca html5-qrcode
    vi.spyOn(Html5Qrcode, 'getCameras').mockResolvedValue([
      { id: 'rear-cam-0', label: 'Back Camera 0' } as any
    ]);

    vi.spyOn(Html5Qrcode.prototype, 'start').mockImplementation(function (
      this: any,
      _cameraId: any,
      _config: any,
      qrCodeSuccessCallback: any
    ) {
      this.isScanning = true;
      cameraScanCallback = qrCodeSuccessCallback;
      if (startCalledPromiseResolve) {
        startCalledPromiseResolve();
      }
      return Promise.resolve(null);
    });

    vi.spyOn(Html5Qrcode.prototype, 'stop').mockImplementation(function (this: any) {
      this.isScanning = false;
      return Promise.resolve();
    });

    vi.spyOn(Html5Qrcode.prototype, 'clear').mockImplementation(() => {});
    vi.spyOn(Html5Qrcode.prototype, 'getRunningTrackCapabilities').mockReturnValue({
      focusMode: ['continuous']
    } as any);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. Monta componente real, inicia câmera, reinicia sessão durante CSRF pendente e descarta resposta tardia', async () => {
    let resolveDelayedCsrf!: (val: any) => void;
    const delayedCsrfPromise = new Promise((resolve) => {
      resolveDelayedCsrf = resolve;
    });

    let scanFetchCallCount = 0;
    const scanRequests: Array<{ url: string; body: any; headers: any }> = [];

    // Mock controlado de rede (fetch)
    globalThis.fetch = vi.fn((input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;

      if (url.includes('/api/csrf-token')) {
        // CSRF inicial demora para resolver
        return delayedCsrfPromise;
      }

      if (url.includes('/api/scan')) {
        scanFetchCallCount++;
        const parsedBody = JSON.parse(init?.body || '{}');
        scanRequests.push({
          url,
          body: parsedBody,
          headers: init?.headers
        });

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: 'COMPLETO',
              reportId: 'rep-real-component-123'
            })
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    }) as any;

    // 1. Montagem do componente no DOM
    await act(async () => {
      root.render(<ScannerMobilePage />);
    });

    // Aguarda microtarefas do getCameras() e renderização inicial
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    // 2. Localiza o botão "Iniciar Leitura"
    const buttons = Array.from(container.querySelectorAll('button'));
    const startButton = buttons.find((b) => b.textContent?.includes('Iniciar Leitura'));
    expect(startButton).toBeDefined();
    expect(startButton!.disabled).toBe(false);

    await act(async () => {
      startButton!.click();
    });

    await act(async () => {
      await startCalledPromise;
    });

    expect(cameraScanCallback).toBeDefined();

    // 3. Câmera decodifica frame enquanto o CSRF inicial ainda está pendente
    await act(async () => {
      cameraScanCallback!('QRBU:1:1:PLEI:2110:UF:AC:MUNI:1392:ZONA:9:SECA:110:URNA:2250280');
      await new Promise((r) => setTimeout(r, 10));
    });

    // 4. Operador clica no botão de Reset de Sessão antes do CSRF resolver
    const resetButton = container.querySelector(
      'button[title="Reiniciar Sessão de Leitura"]'
    ) as HTMLButtonElement;
    expect(resetButton).toBeDefined();

    await act(async () => {
      resetButton.click();
    });

    // 5. Agora o CSRF da requisição antiga finalmente resolve tardiamente
    await act(async () => {
      resolveDelayedCsrf({
        ok: true,
        json: () => Promise.resolve({ csrfToken: 'token-chegou-tarde' })
      });
      await new Promise((r) => setTimeout(r, 50));
    });

    // A requisição antiga NÃO pode ter sido despachada para /api/scan porque a sessão foi reiniciada!
    expect(scanFetchCallCount).toBe(0);
    expect(scanRequests.length).toBe(0);
    expect(mockRouterPush).not.toHaveBeenCalled();

    // 6. Nova leitura na nova sessão vigente
    await act(async () => {
      cameraScanCallback!('QRBU:1:1:PLEI:2110:UF:AC:MUNI:1392:ZONA:9:SECA:110:URNA:2250280');
    });

    // Agora o /api/scan DEVE ter sido chamado com a nova sessão e novo CSRF
    expect(scanFetchCallCount).toBe(1);
    expect(scanRequests[0].headers['X-CSRF-Token']).toBe('token-chegou-tarde');
    expect(scanRequests[0].body.sessionId).toBeDefined();

    // Aguarda o setTimeout de redirecionamento (800ms)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    expect(mockRouterPush).toHaveBeenCalledWith('/admin/conferir/rep-real-component-123');
  });
});

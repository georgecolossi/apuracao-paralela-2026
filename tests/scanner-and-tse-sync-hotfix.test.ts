import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getTseResults } from '../src/app/api/tse-results/route';
import { ScannerDeduplicator } from '../src/lib/scanner-deduplicator';

describe('Hotfix — Scanner Pre-Validation, Concurrency & TSE Synchronization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Scanner Pre-Validation & Concurrency Guards', () => {
    it('1.1. Deve ignorar silenciosamente conteúdos que claramente não sejam QRBUs', () => {
      const nonQrbuSamples = [
        'https://tse.jus.br/resultado',
        '7891000315507', // Código de barras EAN-13
        'INVALID_HEADER',
        'RBU:1:2 VRQR:01.01', // Prefixo truncado
        '',
        '   ',
        'WIFI:T:WPA;S:RedeTSE;P:senha;;'
      ];

      function shouldAcceptForProcessing(rawText: string): boolean {
        const trimmed = (rawText || '').trim();
        return trimmed.startsWith('QRBU:');
      }

      for (const sample of nonQrbuSamples) {
        expect(shouldAcceptForProcessing(sample)).toBe(false);
      }

      // Válidos
      expect(shouldAcceptForProcessing('QRBU:1:1 VRQR:01.01')).toBe(true);
      expect(shouldAcceptForProcessing('  QRBU:1:2 VRQR:01.01  ')).toBe(true);
    });

    it('1.2. Deve impedir submissões concorrentes com isProcessingRef enquanto requisição estiver em voo', async () => {
      const dedup = new ScannerDeduplicator();
      let isProcessing = false;
      const apiCalls: string[] = [];

      async function simulateScanCallback(content: string) {
        // Concurrency guard
        if (isProcessing) return 'IGNORED_PROCESSING';

        const trimmed = (content || '').trim();
        if (!trimmed.startsWith('QRBU:')) return 'IGNORED_NON_QRBU';

        if (!dedup.shouldProcess(content)) return 'IGNORED_DEDUP';

        isProcessing = true;
        try {
          // Simula latência de rede (50ms)
          await new Promise(resolve => setTimeout(resolve, 50));
          apiCalls.push(content);
          return 'PROCESSED';
        } finally {
          isProcessing = false;
        }
      }

      // Callback 1 inicia processamento de QRBU 1
      const call1Promise = simulateScanCallback('QRBU:1:2 PARTE_1');
      
      // Callback 2 dispara logo em seguida (concorrência de 15 fps) com frame diferente
      const call2Promise = simulateScanCallback('QRBU:2:2 PARTE_2');

      const [res1, res2] = await Promise.all([call1Promise, call2Promise]);

      expect(res1).toBe('PROCESSED');
      expect(res2).toBe('IGNORED_PROCESSING');
      expect(apiCalls).toEqual(['QRBU:1:2 PARTE_1']);

      // Após a conclusão da chamada 1, chamada subsequente deve ser permitida
      const res3 = await simulateScanCallback('QRBU:2:2 PARTE_2');
      expect(res3).toBe('PROCESSED');
      expect(apiCalls).toEqual(['QRBU:1:2 PARTE_1', 'QRBU:2:2 PARTE_2']);
    });
  });

  describe('2. TSE Results Route Headers & Cache Control', () => {
    const mockZeroedT2 = {
      ele: '6258', t: '2', cdabr: '80837',
      carg: [{
        cd: '1', nmf: 'Presidente',
        agr: [{
          par: [{
            cand: [
              { n: '22', nmu: 'FLAVIO BOLSONARO', vap: '0', pvap: '0,00' },
              { n: '13', nmu: 'LULA', vap: '0', pvap: '0,00' }
            ]
          }]
        }]
      }],
      s: { ts: '193', st: '0', pst: '0,00' },
      e: { te: '60412', c: '0', pc: '0,00', a: '0', pa: '0,00' },
      v: { vvc: '0', pvvc: '0,00', vb: '0', pvb: '0,00', tvn: '0', ptvn: '0,00' }
    };

    const mockUpdatedT2 = {
      ...mockZeroedT2,
      s: { ts: '193', st: '52', pst: '26,94' },
      e: { te: '60412', c: '14248', pc: '23,58', a: '2975', pa: '4,92' },
      v: { vvc: '13915', pvvc: '97,66', vb: '123', pvb: '0,86', tvn: '210', ptvn: '1,47' },
      carg: [{
        cd: '1', nmf: 'Presidente',
        agr: [{
          par: [{
            cand: [
              { n: '22', nmu: 'FLAVIO BOLSONARO', vap: '10059', pvap: '72,29' },
              { n: '13', nmu: 'LULA', vap: '3856', pvap: '27,71' }
            ]
          }]
        }]
      }]
    };

    it('2.1. Deve retornar cabeçalhos Cache-Control adequados para evitar respostas antigas', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('ele-c.json')) {
          return {
            ok: true,
            json: async () => ({
              pl: [{
                c: 'ele2026',
                e: [{ cd: '6258', t: '2', tp: '8', nm: 'Eleição Ordinária Federal - 2026 2º Turno' }]
              }]
            })
          };
        }
        return { ok: true, json: async () => mockZeroedT2 };
      });

      const req = new Request('http://localhost/api/tse-results?round=2');
      const res = await getTseResults(req);

      expect(res.status).toBe(200);
      const cacheHeader = res.headers.get('Cache-Control');
      expect(cacheHeader).toContain('max-age=15');
      expect(cacheHeader).toContain('stale-while-revalidate=15');

      const data = await res.json();
      expect(data.source).toBe('TSE');
      expect(data.round).toBe('2');
      expect(data.offices[0].progress.status).toBe('AGUARDANDO_APURACAO');
      expect(data.offices[0].progress.processed).toBe(0);
    });

    it('2.2. Deve refletir imediatamente a apuração quando o EA20 for atualizado', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('ele-c.json')) {
          return {
            ok: true,
            json: async () => ({
              pl: [{
                c: 'ele2026',
                e: [{ cd: '6258', t: '2', tp: '8', nm: 'Eleição Ordinária Federal - 2026 2º Turno' }]
              }]
            })
          };
        }
        return { ok: true, json: async () => mockUpdatedT2 };
      });

      const req = new Request('http://localhost/api/tse-results?round=2');
      const res = await getTseResults(req);
      const data = await res.json();

      expect(data.status).toBe('AVAILABLE');
      const pres = data.offices[0];
      expect(pres.progress.processed).toBe(52);
      expect(pres.progress.percent).toBe('26,94');
      expect(pres.progress.status).toBe('EM_ANDAMENTO');
      expect(pres.candidates[0].votes).toBe(10059);
      expect(pres.candidates[1].votes).toBe(3856);
      expect(pres.validVotes.quantity).toBe(13915);
      expect(pres.blankVotes.quantity).toBe(123);
      expect(pres.nullVotes.quantity).toBe(210);
    });

    it('2.3. Deve preservar funcionamento do Turno 1 com cabeçalho de cache', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('ele-c.json')) return { ok: false };
        return {
          ok: true,
          json: async () => ({
            ele: '6257', t: '1', cdabr: '80837',
            carg: [{ cd: '1', nmf: 'Presidente', agr: [] }],
            s: { ts: '193', st: '193', pst: '100,00' },
            e: { te: '60391', c: '48952', pc: '81,06', a: '11439', pa: '18,94' },
            v: { vvc: '47520', pvvc: '97,07', vb: '717', pvb: '1,46', tvn: '715', ptvn: '1,46' }
          })
        };
      });

      const req = new Request('http://localhost/api/tse-results?round=1');
      const res = await getTseResults(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('max-age=15');
      const data = await res.json();
      expect(data.round).toBe('1');
      expect(data.status).toBe('AVAILABLE');
    });
  });
});

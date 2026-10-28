'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
import { useRouter } from 'next/navigation';
import { 
  Camera, 
  Play, 
  Square, 
  RefreshCcw, 
  CheckCircle2, 
  AlertCircle, 
  UploadCloud, 
  ChevronDown, 
  ScanLine, 
  Sparkles,
  Smartphone
} from 'lucide-react';
import { ScannerDeduplicator } from '@/lib/scanner-deduplicator';
import { 
  prioritizeCameras, 
  inspectFocusCapabilities, 
  calculateNormalizedTouchPoint, 
  createTouchFocusConstraints, 
  mapCameraError,
  FocusCapabilities 
} from '@/lib/scanner/cameraManager';
import { MultipartTracker, MultipartProgress } from '@/lib/scanner/multipartState';
import { formatScanError, ErrorDetails } from '@/lib/scanner/qrbuErrorHandler';

export default function ScannerMobilePage() {
  const router = useRouter();

  // Estados de Sessão e CSRF (Sincronizados via Refs para eliminar Stale Closures)
  const [sessionId, setSessionId] = useState<string>('');
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Estados da Câmera e Hardware
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [focusCaps, setFocusCaps] = useState<FocusCapabilities>({
    supportsContinuousFocus: false,
    supportsSpatialTouchFocus: false,
    supportsManualFocusDistance: false,
    hasPointsOfInterest: false
  });
  const [touchPoint, setTouchPoint] = useState<{ x: number; y: number } | null>(null);

  // Estados de Leitura e Feedback
  const [statusMessage, setStatusMessage] = useState<string>('Inicializando câmera...');
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const [multipartProgress, setMultipartProgress] = useState<MultipartProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [scanSuccessFlash, setScanSuccessFlash] = useState<string | null>(null);

  // Entrada Manual e Contingência por Imagem
  const [manualInput, setManualInput] = useState<string>('');

  // Refs de controle de ciclo de vida, concorrência e eliminação de stale closures
  const sessionIdRef = useRef<string>('');
  const csrfTokenRef = useRef<string>('');
  const generationIdRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileQrCodeRef = useRef<Html5Qrcode | null>(null);
  const deduplicatorRef = useRef(new ScannerDeduplicator());
  const multipartTrackerRef = useRef(new MultipartTracker());
  const isProcessingRef = useRef<boolean>(false);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const wasScanningBeforeHiddenRef = useRef<boolean>(false);

  /**
   * Obtém token CSRF de forma resiliente antes de qualquer submissão de leitura.
   */
  const ensureCsrfToken = useCallback(async (): Promise<string | null> => {
    if (csrfTokenRef.current) {
      return csrfTokenRef.current;
    }
    try {
      const res = await fetch('/api/csrf-token');
      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          csrfTokenRef.current = data.csrfToken;
          setCsrfToken(data.csrfToken);
          return data.csrfToken;
        }
      }
    } catch (err) {
      console.warn('Não foi possível obter CSRF token inicial:', err);
    }
    return null;
  }, []);

  /**
   * Inicializa nova sessão única e idempotente com invalidação atômica de requisições anteriores.
   */
  const generateNewSession = useCallback(() => {
    // 1. Incrementa contador monotônico de geração para descartar qualquer resposta pendente
    generationIdRef.current += 1;

    // 2. Aborta ativamente qualquer requisição HTTP em trânsito
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch {
        // ignore
      }
      activeAbortControllerRef.current = null;
    }

    // 3. Gera nova sessão e sincroniza ref imediatamente
    const newSession = `SCAN-MOB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    sessionIdRef.current = newSession;
    setSessionId(newSession);

    // 4. Limpa rastreadores de estado e estados visuais
    deduplicatorRef.current.clear();
    multipartTrackerRef.current.reset();
    setMultipartProgress(null);
    setErrorDetails(null);
    setScanSuccessFlash(null);
    isProcessingRef.current = false;
    setIsProcessing(false);

    return newSession;
  }, []);

  /**
   * Reseta a sessão de leitura a pedido do operador.
   */
  const handleResetSession = () => {
    generateNewSession();
    setStatusMessage('Sessão reiniciada. Aponte para o QR Code do BU.');
  };

  /**
   * Carrega Token CSRF na montagem do componente.
   */
  useEffect(() => {
    void ensureCsrfToken();
  }, [ensureCsrfToken]);

  /**
   * Envia o frame/código lido para o backend homologado (/api/scan).
   * Totalmente protegido contra stale closures e respostas tardias de sessões abandonadas.
   */
  const processQrContent = async (rawDecodedText: string) => {
    // 1. Concorrência mútua estrita: descarta se já houver processamento ativo
    if (isProcessingRef.current) return;

    const trimmed = (rawDecodedText || '').trim();
    if (!trimmed.startsWith('QRBU:')) {
      return;
    }

    // 2. Validação de sessão vigente via Ref
    const currentSession = sessionIdRef.current;
    if (!currentSession) {
      setStatusMessage('Aguardando inicialização da sessão...');
      return;
    }

    if (!deduplicatorRef.current.shouldProcess(trimmed)) {
      return;
    }

    // 3. Validação de token CSRF mais recente via Ref
    const currentCsrf = csrfTokenRef.current || (await ensureCsrfToken());
    if (!currentCsrf) {
      setErrorDetails({
        title: 'Segurança CSRF',
        message: 'Aguardando validação da credencial de segurança. Tente novamente em instantes.',
        isRetryable: true
      });
      setStatusMessage('Aguardando credencial de segurança...');
      return;
    }

    // 4. Trava atômica e captura de geração monotônica
    isProcessingRef.current = true;
    setIsProcessing(true);
    setErrorDetails(null);
    setStatusMessage('Validando QR Code recebido...');

    const reqGeneration = generationIdRef.current;
    const reqSessionId = currentSession;
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': currentCsrf
        },
        body: JSON.stringify({
          content: trimmed,
          isSimulation: false,
          sessionId: reqSessionId
        }),
        signal: abortController.signal
      });

      // Se a geração ou a sessão mudou durante o tráfego HTTP, descarta sumariamente
      if (generationIdRef.current !== reqGeneration || sessionIdRef.current !== reqSessionId) {
        return;
      }

      const data = await res.json();

      // Confirma isolamento após deserialização
      if (generationIdRef.current !== reqGeneration || sessionIdRef.current !== reqSessionId) {
        return;
      }

      if (res.ok) {
        // Feedback háptico no dispositivo móvel quando disponível
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate([40, 30, 40]);
        }

        if (data.status === 'COMPLETO') {
          multipartTrackerRef.current.confirmBackendSuccess();
          const reportId = data.reportId;
          setStatusMessage('Boletim de Urna 100% LIDO e Verificado!');
          setScanSuccessFlash('Boletim lido com sucesso! Redirecionando...');

          if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop().catch(() => {});
          }

          setTimeout(() => {
            // Só redireciona se a sessão ainda for rigorosamente a mesma desta requisição
            if (generationIdRef.current === reqGeneration && sessionIdRef.current === reqSessionId) {
              router.push(`/admin/conferir/${reportId}`);
            }
          }, 800);
        } else if (data.status === 'PARCIAL') {
          const partIndex = data.partIndex || (data.partsRead || 1);
          const totalParts = data.totalParts || (data.partsTotal || 2);
          const envelopeKey = data.envelopeKey || null;

          const registerRes = multipartTrackerRef.current.registerPart(partIndex, totalParts, envelopeKey);
          if (!registerRes.success) {
            setErrorDetails({
              title: 'Fragmento Inconsistente',
              message: registerRes.errorMessage || 'Fragmento multipartes incompatível.',
              isRetryable: true
            });
            setStatusMessage(registerRes.errorMessage || 'Fragmento incompatível.');
          } else {
            setMultipartProgress(registerRes.progress);
            setStatusMessage(registerRes.progress.statusMessage);
            setScanSuccessFlash(`Parte ${partIndex} de ${totalParts} capturada com sucesso!`);
            setTimeout(() => {
              if (generationIdRef.current === reqGeneration) {
                setScanSuccessFlash(null);
              }
            }, 3000);
          }
        }
      } else {
        const errorInfo = formatScanError(res.status, data);
        setErrorDetails(errorInfo);
        setStatusMessage(errorInfo.title);

        if (errorInfo.isRetryable) {
          setTimeout(() => {
            if (generationIdRef.current === reqGeneration) {
              deduplicatorRef.current.clearIfMatches(trimmed);
            }
          }, 2500);
        }
      }
    } catch (err: any) {
      // Se a requisição foi abortada pelo reset da sessão, descarta sem exibir erro
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        return;
      }

      // Se a sessão foi reiniciada durante a requisição, descarta
      if (generationIdRef.current !== reqGeneration || sessionIdRef.current !== reqSessionId) {
        return;
      }

      const netError: ErrorDetails = {
        title: 'Falha de Conexão',
        message: 'Não foi possível comunicar com o servidor. Verifique o sinal da sua rede.',
        isRetryable: true
      };
      setErrorDetails(netError);
      setStatusMessage(netError.title);
      setTimeout(() => {
        if (generationIdRef.current === reqGeneration) {
          deduplicatorRef.current.clearIfMatches(trimmed);
        }
      }, 2500);
    } finally {
      // Limpa abort controller se ainda for este
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
      // Só libera processamento se a geração não tiver sido reiniciada externamente
      if (generationIdRef.current === reqGeneration) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    }
  };

  /**
   * Inicia o fluxo de leitura da câmera com foco contínuo e prioridade traseira.
   */
  const startScanning = async () => {
    if (!activeCameraId) return;
    setErrorDetails(null);

    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode('qr-reader-container', {
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          },
          verbose: false
        });
      }

      await html5QrCodeRef.current.start(
        activeCameraId,
        {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            // Área de enquadramento generosa (82% da menor dimensão do visor)
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const edge = Math.floor(minEdge * 0.82);
            const safeEdge = Math.max(60, edge);
            return { width: safeEdge, height: safeEdge };
          },
          aspectRatio: 1.333333 // Proporção padrão 4:3 de câmeras móveis (sem letterboxing)
        },
        (decodedText) => {
          // O processQrContent acessa sessionIdRef e csrfTokenRef diretamente,
          // eliminando qualquer risco de captura de valores obsoletos na closure da biblioteca
          void processQrContent(decodedText);
        },
        () => {} // Ignora frames sem QR Code
      );

      setIsScanning(true);
      setStatusMessage('Câmera ativa. Aponte para o QR Code do BU.');

      // Inspeciona recursos reais de hardware do track de vídeo
      try {
        if (typeof html5QrCodeRef.current.getRunningTrackCapabilities === 'function') {
          const rawCaps = html5QrCodeRef.current.getRunningTrackCapabilities();
          const parsedCaps = inspectFocusCapabilities(rawCaps);
          setFocusCaps(parsedCaps);

          // Solicita foco contínuo SOMENTE se o hardware tiver suporte comprovado
          if (parsedCaps.supportsContinuousFocus) {
            await html5QrCodeRef.current.applyVideoConstraints({
              advanced: [{ focusMode: 'continuous' }] as any
            }).catch(() => {});
          }
        }
      } catch (capErr) {
        console.warn('Inspeção de capabilities não suportada no navegador:', capErr);
      }
    } catch (err) {
      const friendlyErr = mapCameraError(err);
      setErrorDetails({
        title: 'Erro na Câmera',
        message: friendlyErr,
        isRetryable: true
      });
      setStatusMessage('Falha ao abrir a câmera.');
      setIsScanning(false);
    }
  };

  /**
   * Para a leitura e libera completamente os recursos de hardware.
   */
  const stopScanning = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.error('Erro ao parar câmera:', err);
      }
    }
    setIsScanning(false);
    setTouchPoint(null);
    setStatusMessage('Câmera desativada.');
  };

  /**
   * Foco por Toque (Touch-to-Focus) Honesto.
   * Não executa animação nem simulação se o hardware não oferecer suporte real a coordenadas espaciais (pointsOfInterest).
   */
  const handleTouchFocus = async (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isScanning || !focusCaps.supportsSpatialTouchFocus || !html5QrCodeRef.current) {
      return;
    }

    const container = viewfinderRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return;
    }

    const norm = calculateNormalizedTouchPoint(clientX, clientY, rect);
    if (!norm) return;

    const constraints = createTouchFocusConstraints(norm, focusCaps);
    if (!constraints) return;

    try {
      await html5QrCodeRef.current.applyVideoConstraints(constraints as any);

      // Exibe anel visual APENAS após confirmação de aplicação pelo hardware
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;
      setTouchPoint({ x: relativeX, y: relativeY });

      setTimeout(() => {
        setTouchPoint(null);
      }, 1200);
    } catch (touchErr) {
      console.warn('Aplicação de touch-focus falhou no hardware:', touchErr);
      setTouchPoint(null);
    }
  };

  /**
   * Contingência por Captura Estática / Foto (iOS Safari / Sem foco em tempo real).
   */
  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Concorrência mútua
    if (isProcessingRef.current) {
      e.target.value = '';
      return;
    }

    setStatusMessage('Decodificando foto do BU...');
    setErrorDetails(null);

    try {
      if (!fileQrCodeRef.current) {
        fileQrCodeRef.current = new Html5Qrcode('qr-file-temp-container', { verbose: false });
      }

      const decodedText = await fileQrCodeRef.current.scanFile(file, false);
      await processQrContent(decodedText);
    } catch {
      setErrorDetails({
        title: 'Foto Não Reconhecida',
        message: 'Não foi possível localizar um QR Code nítido na imagem enviada. Certifique-se de que o QRBU esteja bem iluminado e sem reflexos.',
        isRetryable: true
      });
      setStatusMessage('Falha ao decodificar foto.');
    } finally {
      e.target.value = ''; // Permite reenviar a mesma foto se necessário
    }
  };

  /**
   * Entrada manual alternativa protegida contra concorrência.
   */
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessingRef.current) return;
    if (manualInput.trim()) {
      const textToProcess = manualInput.trim();
      setManualInput('');
      void processQrContent(textToProcess);
    }
  };

  /**
   * Ciclo de vida: Inicialização, Priorização de Câmeras Traseiras e VisibilityChange.
   */
  useEffect(() => {
    generateNewSession();

    // Busca e prioriza câmeras disponíveis
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices && devices.length > 0) {
          const prioritized = prioritizeCameras(devices);
          setCameras(prioritized);
          setActiveCameraId(prioritized[0].id);
          setStatusMessage('Câmera traseira identificada. Clique em Iniciar Leitura.');
        } else {
          setStatusMessage('Nenhuma câmera encontrada neste dispositivo.');
        }
      })
      .catch((err) => {
        const friendlyMsg = mapCameraError(err);
        setErrorDetails({
          title: 'Acesso à Câmera',
          message: friendlyMsg,
          isRetryable: true
        });
        setStatusMessage('Permissão necessária.');
      });

    // Tratamento de interrupção e retorno de abas / minimização do navegador
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
          wasScanningBeforeHiddenRef.current = true;
          void html5QrCodeRef.current.stop().catch(() => {});
          setIsScanning(false);
        }
      } else if (document.visibilityState === 'visible') {
        if (wasScanningBeforeHiddenRef.current) {
          wasScanningBeforeHiddenRef.current = false;
          // Retoma leitura com pequeno atraso para estabilização de tela
          setTimeout(() => {
            void startScanning();
          }, 300);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Limpeza mandatória de hardware ao desmontar
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().catch(console.error);
      }
      if (fileQrCodeRef.current) {
        fileQrCodeRef.current.clear();
      }
    };
  }, [generateNewSession]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-12 selection:bg-indigo-500 selection:text-white">
      {/* Container invisível para contingência de arquivos */}
      <div id="qr-file-temp-container" className="hidden" aria-hidden="true"></div>

      <header className="w-full bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-20 px-4 py-3.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Scanner de Boletim de Urna
                <span className="text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
                  Universal v2.0
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Sessão:{' '}
                <span className="font-mono text-slate-300">
                  {sessionId ? sessionId.slice(-8) : 'Iniciando...'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetSession}
            title="Reiniciar Sessão de Leitura"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors border border-slate-700/60"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl w-full mx-auto p-4 flex flex-col gap-4 flex-1">
        {/* Flash de Confirmação de Sucesso */}
        {scanSuccessFlash && (
          <div className="w-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-xl flex items-center gap-3 animate-in fade-in duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-xs font-semibold">{scanSuccessFlash}</p>
          </div>
        )}

        {/* Alerta de Erro com Ação Recomandada */}
        {errorDetails && (
          <div className="w-full bg-rose-500/15 border border-rose-500/30 text-rose-200 p-4 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs flex-1">
              <p className="font-bold text-rose-300 uppercase tracking-wide">{errorDetails.title}</p>
              <p className="mt-1 text-slate-300 leading-relaxed">{errorDetails.message}</p>
              {errorDetails.technicalCode && (
                <p className="mt-2 font-mono text-[11px] text-slate-400 bg-slate-900/80 p-1.5 rounded border border-slate-800 inline-block">
                  Código: {errorDetails.technicalCode}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Visor da Câmera com Aspect-Ratio 4:3 e Guia Visual */}
        <div className="relative w-full aspect-[3/4] sm:aspect-[4/3] bg-black rounded-3xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col justify-center items-center">
          <div
            ref={viewfinderRef}
            onClick={handleTouchFocus}
            onTouchStart={handleTouchFocus}
            className={`w-full h-full relative cursor-pointer select-none overflow-hidden ${
              focusCaps.supportsSpatialTouchFocus ? 'touch-manipulation' : ''
            }`}
          >
            {/* Viewport de Vídeo do html5-qrcode */}
            <div
              id="qr-reader-container"
              className="w-full h-full [&>div]:!border-none [&_video]:!object-cover [&_video]:!w-full [&_video]:!h-full"
            ></div>

            {/* Marcadores de Enquadramento Modernos nos 4 Cantos */}
            {isScanning && (
              <div className="absolute inset-0 pointer-events-none p-6 sm:p-8 flex flex-col justify-between">
                <div className="flex justify-between">
                  <div className="w-8 h-8 border-t-4 border-l-4 border-indigo-400 rounded-tl-xl shadow-sm"></div>
                  <div className="w-8 h-8 border-t-4 border-r-4 border-indigo-400 rounded-tr-xl shadow-sm"></div>
                </div>

                {/* Linha Sutil de Escaneamento Contínuo */}
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent opacity-75 animate-pulse"></div>

                <div className="flex justify-between">
                  <div className="w-8 h-8 border-b-4 border-l-4 border-indigo-400 rounded-bl-xl shadow-sm"></div>
                  <div className="w-8 h-8 border-b-4 border-r-4 border-indigo-400 rounded-br-xl shadow-sm"></div>
                </div>
              </div>
            )}

            {/* Anel de Foco por Toque Real (Renderizado APENAS quando comprovadamente suportado pelo hardware) */}
            {touchPoint && focusCaps.supportsSpatialTouchFocus && (
              <div
                style={{ left: touchPoint.x, top: touchPoint.y }}
                className="absolute w-14 h-14 -ml-7 -mt-7 rounded-full border-2 border-amber-300 bg-amber-400/20 pointer-events-none animate-ping"
              ></div>
            )}

            {/* Estado quando a Câmera está Parada */}
            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-slate-900/90 gap-3 p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400">
                  <Camera className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-300">Câmera em Espera</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    Clique no botão abaixo para ativar a leitura contínua do Boletim de Urna.
                  </p>
                </div>
              </div>
            )}

            {/* Overlay de Processamento Concorrente */}
            {isProcessing && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-center p-4">
                <RefreshCcw className="w-10 h-10 text-indigo-400 animate-spin mb-3" />
                <p className="text-sm font-bold text-white tracking-wide uppercase">Processando Envelope...</p>
                <p className="text-xs text-slate-400 mt-1">Verificando criptografia e integridade eleitoral</p>
              </div>
            )}
          </div>

          {/* Status Atual Informativo */}
          <div className="w-full mt-3 text-center">
            <span className="text-xs font-semibold px-4 py-1.5 rounded-full bg-slate-800/90 text-slate-300 border border-slate-700/60 inline-flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
              {statusMessage}
            </span>
          </div>
        </div>

        {/* Seletor de Câmera e Controles Principais */}
        <div className="w-full flex flex-col gap-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
          {cameras.length > 1 && !isScanning && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                Selecione a Câmera Traseira
              </label>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={activeCameraId}
                onChange={(e) => setActiveCameraId(e.target.value)}
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label || `Câmera ${c.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {!isScanning ? (
              <button
                type="button"
                onClick={startScanning}
                disabled={!activeCameraId || isProcessing}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                Iniciar Leitura
              </button>
            ) : (
              <button
                type="button"
                onClick={stopScanning}
                className="w-full py-3.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-sm uppercase tracking-wider flex items-center justify-center gap-2 border border-slate-700 transition-all"
              >
                <Square className="w-4 h-4 fill-current" />
                Pausar Câmera
              </button>
            )}

            {/* Botão de Contingência para Foto (iOS Safari / Dificuldade de foco) */}
            <label className="w-full py-3.5 px-4 bg-slate-800/90 hover:bg-slate-700/90 text-indigo-300 font-bold rounded-xl text-sm uppercase tracking-wider flex items-center justify-center gap-2 border border-indigo-500/30 cursor-pointer transition-all">
              <UploadCloud className="w-4 h-4" />
              <span>Fotografar QRBU</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileCapture}
                disabled={isProcessing}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Painel Multipartes com Progresso Inequívoco */}
        {multipartProgress && multipartProgress.totalParts > 1 && (
          <div className="w-full bg-slate-900 border border-indigo-500/30 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Boletim Multipartes ({multipartProgress.readCount} de {multipartProgress.totalParts} lidas)
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                {multipartProgress.missingIndices.length === 0 ? 'COMPLETO' : 'PENDENTE'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3.5">
              {Array.from({ length: multipartProgress.totalParts }).map((_, idx) => {
                const partNum = idx + 1;
                const isRead = multipartProgress.receivedIndices.includes(partNum);
                return (
                  <div
                    key={partNum}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                      isRead
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm'
                        : 'bg-slate-800/50 border-slate-700/60 text-slate-400'
                    }`}
                  >
                    {isRead ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-slate-600"></div>
                    )}
                    <span>Parte {partNum}</span>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-slate-300 font-medium bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/40 text-center">
              {multipartProgress.statusMessage}
            </p>
          </div>
        )}

        {/* Entrada Manual Colapsável (Alternativa de Segurança) */}
        <div className="w-full bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          <details className="group">
            <summary className="font-semibold text-slate-400 cursor-pointer list-none flex items-center justify-between p-4 hover:bg-slate-800/40 transition-colors">
              <span className="text-xs uppercase tracking-wider flex items-center gap-2">
                Entrada Manual de Texto <span className="text-[10px] text-slate-500">(Contingência)</span>
              </span>
              <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" />
            </summary>
            <div className="p-4 border-t border-slate-800/80 bg-slate-950/50">
              <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
                <textarea
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-mono text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none h-20"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Cole aqui o payload bruto que inicia com QRBU:..."
                ></textarea>
                <button
                  type="submit"
                  disabled={!manualInput.trim() || isProcessing}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  Processar Texto Manual
                </button>
              </form>
            </div>
          </details>
        </div>
      </main>
    </div>
  );
}

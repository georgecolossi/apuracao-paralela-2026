'use client';

import { useEffect, useState, useRef } from 'react';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
import { useRouter } from 'next/navigation';
import { ScanLine, AlertCircle, RefreshCcw, CheckCircle2, ChevronDown, Camera, Play, Square, Flashlight, ZoomIn } from 'lucide-react';
import { ScannerDeduplicator } from '@/lib/scanner-deduplicator';

export default function ScannerPage() {
  const [status, setStatus] = useState<string>('Aguardando inicialização da câmera...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [partsInfo, setPartsInfo] = useState<{ read: number, total: number } | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const deduplicatorRef = useRef(new ScannerDeduplicator());
  
  // Custom camera states
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  
  const router = useRouter();

  const resetSession = () => {
    setSessionId(`UI-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    setPartsInfo(null);
    setErrorMsg(null);
    setStatus('Aguardando leitura do QR Code...');
    deduplicatorRef.current.clear();
    isProcessingRef.current = false;
    setIsProcessing(false);
  };

  useEffect(() => {
    setSessionId(`UI-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    
    // Init cameras with rear camera priority
    Html5Qrcode.getCameras().then(devices => {
      if (devices && devices.length > 0) {
        setCameras(devices);
        const backCamera = devices.find(d => {
          const label = (d.label || '').toLowerCase();
          return label.includes('back') || label.includes('traseira') || label.includes('rear') || label.includes('environment');
        });
        const defaultCam = backCamera || devices[devices.length - 1] || devices[0];
        setActiveCameraId(defaultCam.id);
        setStatus('Câmera pronta. Clique em Iniciar.');
      } else {
        setStatus('Nenhuma câmera encontrada.');
      }
    }).catch(err => {
      setStatus('Erro ao buscar câmeras ou permissão negada.');
      console.error(err);
    });
    
    return () => {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const startScanning = async () => {
    if (!activeCameraId) return;
    try {
      html5QrCodeRef.current = new Html5Qrcode("reader", {
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        verbose: false
      });
      await html5QrCodeRef.current.start(
        activeCameraId,
        {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const edge = Math.max(250, Math.floor(minEdge * 0.8));
            return { width: edge, height: edge };
          },
          aspectRatio: 1.0
        },
        (decodedText) => {
          void processQrContent(decodedText);
        },
        () => {}
      );
      setIsScanning(true);
      setStatus('Aguardando leitura do QR Code...');

      // Safe hardware capabilities inspection
      try {
        const capabilities = html5QrCodeRef.current.getRunningTrackCapabilities();
        if (capabilities && (capabilities as any).torch) {
          setHasTorch(true);
        }
        if (capabilities && (capabilities as any).zoom) {
          const z = (capabilities as any).zoom;
          if (typeof z.min === 'number' && typeof z.max === 'number' && z.max > z.min) {
            setZoomRange({ min: z.min, max: z.max, step: z.step || 0.1 });
            setCurrentZoom(z.min);
          }
        }
        if (capabilities && (capabilities as any).focusMode && (capabilities as any).focusMode.includes('continuous')) {
          await html5QrCodeRef.current.applyVideoConstraints({
            advanced: [{ focusMode: 'continuous' }] as any
          }).catch(() => {});
        }
      } catch {
        // Fallback safely if track capabilities are not exposed
      }
    } catch {
      setErrorMsg('Falha ao iniciar a câmera.');
    }
  };

  const stopScanning = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.error(err);
      }
    }
    setIsScanning(false);
    setHasTorch(false);
    setTorchOn(false);
    setZoomRange(null);
    setStatus('Câmera parada.');
  };

  const toggleTorch = async () => {
    if (!html5QrCodeRef.current || !hasTorch) return;
    try {
      const nextTorch = !torchOn;
      await html5QrCodeRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch }] as any
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn('Torch toggle failed', err);
    }
  };

  const handleZoomChange = async (newZoom: number) => {
    if (!html5QrCodeRef.current || !zoomRange) return;
    try {
      await html5QrCodeRef.current.applyVideoConstraints({
        advanced: [{ zoom: newZoom }] as any
      });
      setCurrentZoom(newZoom);
    } catch (err) {
      console.warn('Zoom change failed', err);
    }
  };

  const processQrContent = async (rawDecodedText: string) => {
    // 1. Concurrency guard: ignore new frames while another is in flight
    if (isProcessingRef.current) return;

    // 2. Local pre-validation: silently ignore non-QRBU content (do not mutate/truncate rawDecodedText)
    const trimmed = (rawDecodedText || '').trim();
    if (!trimmed.startsWith('QRBU:')) {
      return;
    }

    // 3. Deduplication check
    if (!deduplicatorRef.current.shouldProcess(rawDecodedText)) return;
    
    isProcessingRef.current = true;
    setIsProcessing(true);
    setErrorMsg(null);
    setStatus('Processando leitura...');

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: rawDecodedText, isSimulation: false, sessionId })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        if (data.status === 'COMPLETO') {
          setStatus('Boletim LIDO COMPLETO!');
          if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          router.push(`/admin/conferir/${data.reportId}`);
        } else if (data.status === 'PARCIAL') {
          const tParts = data.totalParts || data.partsTotal;
          setStatus(`Parte Lida. Lidos: ${data.partsRead} de ${tParts}`);
          setPartsInfo({ read: data.partsRead, total: tParts });
        }
      } else {
        const displayError = data.error || data.message || 'Erro desconhecido';
        if (displayError.includes('DUPLICADO')) {
          setErrorMsg('Este Boletim já foi processado anteriormente (DUPLICADO).');
        } else if (displayError.includes('simula') || displayError.includes('SIMULATED')) {
          setErrorMsg('Modo Simulação detectado: Use a interface correta ou limpe a sessão.');
        } else if (displayError.includes('ordem') || displayError.includes('ORDER')) {
          setErrorMsg('Partes fora de ordem ou inconsistentes. Tente reiniciar a sessão.');
        } else if (displayError.includes('INVALID_HEADER')) {
          setErrorMsg('Cabeçalho oficial QRBU mal formatado ou corrompido.');
        } else {
          setErrorMsg(displayError);
        }
        
        setStatus('Aguardando leitura...');
        // Em caso de erro, permitir que a câmera releia o mesmo QR após 3 segundos
        setTimeout(() => {
          deduplicatorRef.current.clearIfMatches(rawDecodedText);
        }, 3000);
      }
    } catch {
      setErrorMsg('Falha de conexão com o servidor. Tente novamente.');
      setStatus('Aguardando leitura...');
      setTimeout(() => {
        deduplicatorRef.current.clearIfMatches(rawDecodedText);
      }, 3000);
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      void processQrContent(manualInput.trim());
      setManualInput('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 flex flex-col items-center">
        <div className="w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="bg-slate-50 border-b border-slate-200 p-5 text-center">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Leitura de QRBU</h2>
            <p className="text-slate-500 font-medium text-sm mt-1 uppercase tracking-wider">Aponte a câmera para o QR Code do Boletim de Urna.</p>
          </div>
          
          <div className="p-6 flex flex-col items-center">
            {errorMsg && (
              <div className="w-full bg-red-50 border border-red-200 text-red-800 p-4 mb-6 rounded-xl shadow-sm flex items-start gap-3">
                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <h3 className="font-bold uppercase tracking-wide text-sm">Atenção</h3>
                  <p className="font-medium text-sm mt-0.5">{errorMsg}</p>
                </div>
              </div>
            )}

            {/* Custom Camera Controls */}
            <div className="w-full max-w-md mx-auto mb-4 flex flex-col gap-3">
              {cameras.length > 0 && !isScanning && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5" />
                    Selecione a Câmera
                  </label>
                  <select 
                    className="w-full border border-slate-300 bg-slate-50 p-3 rounded-xl text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium appearance-none"
                    value={activeCameraId}
                    onChange={(e) => setActiveCameraId(e.target.value)}
                  >
                    {cameras.map(cam => (
                      <option key={cam.id} value={cam.id}>{cam.label || `Câmera ${cam.id}`}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div className="flex gap-2">
                {!isScanning ? (
                  <button 
                    onClick={startScanning} 
                    disabled={!activeCameraId}
                    className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm shadow-indigo-600/20 uppercase tracking-wide text-sm flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Iniciar Câmera
                  </button>
                ) : (
                  <button 
                    onClick={stopScanning} 
                    className="flex-1 bg-red-100 text-red-700 font-bold py-3 rounded-xl hover:bg-red-200 hover:text-red-800 transition-colors uppercase tracking-wide text-sm flex items-center justify-center gap-2"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Parar Câmera
                  </button>
                )}
              </div>

              {isScanning && (hasTorch || zoomRange) && (
                <div className="flex items-center justify-between gap-3 bg-slate-900 text-white p-3 rounded-2xl shadow-sm">
                  {hasTorch ? (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${torchOn ? 'bg-amber-400 text-slate-900 font-black shadow-sm' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
                    >
                      <Flashlight className="w-3.5 h-3.5" />
                      {torchOn ? 'Lanterna Ligada' : 'Lanterna'}
                    </button>
                  ) : <div />}
                  {zoomRange && (
                    <div className="flex items-center gap-2">
                      <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs font-mono font-bold text-slate-300">{currentZoom.toFixed(1)}x</span>
                      <input
                        type="range"
                        min={zoomRange.min}
                        max={Math.min(zoomRange.max, 3)}
                        step={zoomRange.step}
                        value={currentZoom}
                        onChange={(e) => void handleZoomChange(parseFloat(e.target.value))}
                        className="w-24 accent-indigo-500 cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`w-full max-w-md mx-auto rounded-2xl overflow-hidden shadow-inner mb-6 relative border-4 transition-colors ${isScanning ? 'border-indigo-500 bg-slate-950' : 'border-slate-200 bg-slate-100 min-h-[300px] flex items-center justify-center'}`}>
              <div id="reader" className="w-full [&>div]:!border-none [&_video]:!object-cover"></div>
              
              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                  <Camera className="w-12 h-12 mb-2 opacity-50" />
                  <span className="font-bold text-sm uppercase tracking-wider">Câmera Inativa</span>
                </div>
              )}

              {isProcessing && (
                <div className="absolute inset-0 bg-slate-900/80 flex flex-col items-center justify-center z-10 backdrop-blur-sm">
                  <RefreshCcw className="w-10 h-10 text-white animate-spin mb-3" />
                  <p className="font-bold text-white tracking-wider uppercase text-sm">Processando...</p>
                </div>
              )}
            </div>

            <div className="w-full text-center mb-6">
              <p className={`text-sm uppercase tracking-wider font-bold px-6 py-2.5 rounded-full inline-flex items-center gap-2 shadow-sm ${status.includes('COMPLETO') ? 'bg-emerald-100 border border-emerald-200 text-emerald-800' : 'bg-slate-100 border border-slate-200 text-slate-700'}`}>
                {status.includes('COMPLETO') && <CheckCircle2 className="w-4 h-4" />}
                {status}
              </p>
            </div>

            {partsInfo && (
              <div className="w-full max-w-md mx-auto bg-indigo-50 border border-indigo-100 rounded-2xl p-5 mb-6">
                <h3 className="font-bold text-indigo-900 uppercase tracking-wide text-xs mb-4 flex items-center gap-2">
                  <ScanLine className="w-4 h-4" />
                  Boletim Multipart (Em Leitura)
                </h3>
                <div className="space-y-3">
                  {Array.from({ length: partsInfo.total }).map((_, i) => {
                    const isRead = i < partsInfo.read;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className={`w-8 h-8 flex items-center justify-center rounded-full shadow-sm ${isRead ? 'bg-emerald-500 text-white' : 'bg-white border border-indigo-200 text-indigo-400'}`}>
                          {isRead ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-xs font-black">{i + 1}</span>}
                        </div>
                        <span className={`font-bold text-sm uppercase tracking-wide ${isRead ? 'text-emerald-700' : 'text-indigo-400'}`}>
                          QR Code {i + 1} {isRead ? 'Lido' : 'Pendente'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-5 text-center">
                  <div className="bg-indigo-600 text-white font-bold text-xs py-1.5 px-4 rounded-full inline-block uppercase tracking-wider">
                    {partsInfo.read} de {partsInfo.total} lidos
                  </div>
                </div>
              </div>
            )}
            
            <button 
              onClick={resetSession}
              className="w-full max-w-md py-3.5 bg-white hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition-colors border border-slate-300 flex items-center justify-center gap-2 uppercase tracking-wide text-sm shadow-sm"
            >
              <RefreshCcw className="w-4 h-4" />
              Reiniciar Leitura Atual
            </button>
          </div>
        </div>

        <div className="w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <details className="group">
            <summary className="font-bold text-slate-700 cursor-pointer list-none flex items-center justify-between p-6 hover:bg-slate-50">
              <span className="flex items-center gap-2 uppercase tracking-wide text-sm">
                Entrada Manual <span className="text-xs font-medium text-slate-400 ml-1">(Alternativa)</span>
              </span>
              <ChevronDown className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="p-6 border-t border-slate-100 bg-slate-50">
              <form onSubmit={handleManualSubmit} className="flex flex-col gap-4">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Cole o texto extraído do QR Code:</label>
                <textarea 
                  className="w-full border border-slate-300 rounded-xl p-4 text-sm font-mono h-24 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm resize-y bg-white text-slate-900"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  placeholder="Ex: QRBU:1:1:1:2:123456..."
                ></textarea>
                <button 
                  type="submit" 
                  disabled={!manualInput.trim() || isProcessing}
                  className="bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm shadow-slate-900/20 uppercase tracking-wide text-sm"
                >
                  Processar Código Manual
                </button>
              </form>
            </div>
          </details>
        </div>
      </main>
    </div>
  );
}

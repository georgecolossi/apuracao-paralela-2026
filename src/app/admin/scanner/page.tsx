'use client';

import { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useRouter } from 'next/navigation';
import { ScanLine, AlertCircle, RefreshCcw, CheckCircle2, ChevronDown, MonitorPlay } from 'lucide-react';

export default function ScannerPage() {
  const [status, setStatus] = useState<string>('Aguardando leitura do QR Code...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [partsInfo, setPartsInfo] = useState<{ read: number, total: number } | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const processedRef = useRef<Set<string>>(new Set());
  
  const router = useRouter();

  const resetSession = () => {
    setSessionId(`UI-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    setPartsInfo(null);
    setErrorMsg(null);
    setStatus('Aguardando leitura do QR Code...');
  };

  useEffect(() => {
    // eslint-disable-next-line
    setSessionId(`UI-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  }, []);

  const processQrContent = async (decodedText: string) => {
    if (processedRef.current.has(decodedText)) return;
    if (isProcessing) return;
    
    setIsProcessing(true);
    setErrorMsg(null);
    setStatus('Processando leitura...');

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: decodedText, sessionId, isSimulation: false })
      });
      
      const data = await res.json();
      
      if (res.status === 409 || data.status === 'DUPLICADO') {
        processedRef.current.add(decodedText);
        setErrorMsg('Este Boletim de Urna já foi processado anteriormente.');
        setStatus('Leitura rejeitada (Duplicidade)');
      } else if (res.ok) {
        processedRef.current.add(decodedText);
        if (data.status === 'COMPLETO') {
          setStatus('Boletim Completo! Redirecionando...');
          router.push(`/admin/conferir/${data.reportId}`);
        } else if (data.status === 'PARCIAL') {
          setPartsInfo({ read: data.partsRead, total: data.totalParts });
          setStatus(`Parte lida com sucesso! (${data.partsRead}/${data.totalParts})`);
        }
      } else {
        const displayError = data.error || 'Erro desconhecido ao processar parte.';
        if (displayError.includes('Assinatura')) {
          setErrorMsg('QR Code inválido: Falha de assinatura ou não é um QRBU oficial.');
        } else if (displayError.includes('ordem')) {
          setErrorMsg('Partes fora de ordem ou inconsistentes. Tente reiniciar a sessão.');
        } else {
          setErrorMsg(displayError);
        }
        
        setStatus('Aguardando leitura...');
        setTimeout(() => {
          processedRef.current.delete(decodedText);
        }, 3000);
      }
    } catch {
      setErrorMsg('Falha de conexão com o servidor. Tente novamente.');
      setStatus('Aguardando leitura...');
      setTimeout(() => {
        processedRef.current.delete(decodedText);
      }, 3000);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 5, qrbox: { width: 300, height: 300 }, rememberLastUsedCamera: true },
      false
    );

    scanner.render((decodedText) => {
      void processQrContent(decodedText);
    }, () => {});

    return () => {
      scanner.clear().catch(e => console.error('Erro ao limpar scanner:', e));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      void processQrContent(manualInput.trim());
      setManualInput('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      <header className="bg-slate-900 text-white shadow-md border-b-4 border-indigo-600">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanLine className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-bold uppercase tracking-tight">Operação <span className="text-indigo-400">Scanner</span></h1>
          </div>
          <a href="/apuracao" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-white border border-slate-700 transition-colors">
            <MonitorPlay className="w-4 h-4" />
            <span className="hidden sm:inline">Painel Público</span>
          </a>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 flex flex-col items-center">
        <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="bg-slate-50 border-b border-slate-200 p-5 text-center">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Leitura de QRBU</h2>
            <p className="text-slate-500 text-sm mt-1">Aponte a câmera para o QR Code do Boletim de Urna.</p>
          </div>
          
          <div className="p-6 flex flex-col items-center">
            {errorMsg && (
              <div className="w-full bg-red-50 border-l-4 border-red-500 text-red-800 p-4 mb-6 rounded-lg shadow-sm flex items-start gap-3">
                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <h3 className="font-bold">Atenção</h3>
                  <p className="font-medium text-sm mt-1">{errorMsg}</p>
                </div>
              </div>
            )}

            <div className="w-full max-w-md mx-auto bg-slate-950 rounded-xl overflow-hidden shadow-inner mb-6 relative border-4 border-slate-900">
              <div id="reader" className="w-full [&>div]:!border-none [&_video]:!object-cover"></div>
              {isProcessing && (
                <div className="absolute inset-0 bg-slate-900/80 flex flex-col items-center justify-center z-10 backdrop-blur-sm">
                  <RefreshCcw className="w-10 h-10 text-white animate-spin mb-3" />
                  <p className="font-bold text-white tracking-wider uppercase text-sm">Processando...</p>
                </div>
              )}
            </div>

            <div className="w-full text-center mb-6">
              <p className={`text-lg font-bold px-4 py-2 rounded-full inline-block ${status.includes('Completo') ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-50 text-indigo-800'}`}>
                {status}
              </p>
            </div>

            {partsInfo && (
              <div className="w-full max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6">
                <h3 className="font-bold text-slate-700 uppercase tracking-wide text-xs mb-4">Boletim Multipart (Em Leitura)</h3>
                <div className="space-y-3">
                  {Array.from({ length: partsInfo.total }).map((_, i) => {
                    const isRead = i < partsInfo.read;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className={`w-7 h-7 flex items-center justify-center rounded-full shadow-sm ${isRead ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                          {isRead ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-xs font-bold">{i + 1}</span>}
                        </div>
                        <span className={`font-semibold text-sm ${isRead ? 'text-emerald-700' : 'text-slate-500'}`}>
                          QR Code {i + 1} {isRead ? 'Lido com sucesso' : 'Pendente'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-5 text-center">
                  <div className="bg-indigo-100 text-indigo-800 font-bold text-sm py-1.5 px-4 rounded-full inline-block">
                    {partsInfo.read} de {partsInfo.total} lidos
                  </div>
                </div>
              </div>
            )}
            
            <button 
              onClick={resetSession}
              className="w-full max-w-md py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors border border-slate-300 flex items-center justify-center gap-2"
            >
              <RefreshCcw className="w-4 h-4" />
              Reiniciar Leitura Atual
            </button>
          </div>
        </div>

        <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <details className="group">
            <summary className="font-bold text-slate-700 cursor-pointer list-none flex items-center justify-between p-5 hover:bg-slate-50">
              <span className="flex items-center gap-2">
                Entrada Manual <span className="text-xs font-normal text-slate-400 uppercase tracking-wider">(Alternativa)</span>
              </span>
              <ChevronDown className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="p-5 border-t border-slate-100 bg-slate-50">
              <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
                <label className="text-sm font-semibold text-slate-700">Cole o texto extraído do QR Code:</label>
                <textarea 
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm font-mono h-24 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm resize-y"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  placeholder="Ex: QRBU:1:1:1:2:123456..."
                ></textarea>
                <button 
                  type="submit" 
                  disabled={!manualInput.trim() || isProcessing}
                  className="bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-sm"
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

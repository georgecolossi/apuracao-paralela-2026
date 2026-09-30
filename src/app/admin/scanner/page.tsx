'use client';

import { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useRouter } from 'next/navigation';

export default function ScannerPage() {
  const [status, setStatus] = useState<string>('Aguardando leitura do QR Code...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [partsInfo, setPartsInfo] = useState<{ read: number, total: number } | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const processedRef = useRef<Set<string>>(new Set());
  
  const router = useRouter();

  // Generate a new session ID when component mounts or resets
  const resetSession = () => {
    setSessionId(`UI-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    setPartsInfo(null);
    setErrorMsg(null);
    setStatus('Aguardando leitura do QR Code...');
    processedRef.current.clear();
  };

  useEffect(() => {
    resetSession();
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
        setErrorMsg('BOLETIM JÁ PROCESSADO: Este Boletim de Urna já foi registrado anteriormente e não será contabilizado novamente.');
        setStatus('Leitura rejeitada.');
        // Don't add to processedRef so they can try another one, or maybe we do so it stops beeping?
        processedRef.current.add(decodedText);
        setTimeout(resetSession, 5000);
      } else if (res.ok) {
        processedRef.current.add(decodedText);
        
        if (data.status === 'COMPLETO') {
          setStatus('BU Completo! Redirecionando para conferência...');
          setPartsInfo(null);
          setTimeout(() => {
            router.push(`/admin/conferir/${data.reportId}`);
          }, 1000);
        } else if (data.status === 'PARCIAL') {
          setStatus(`Parte lida com sucesso. Continue escaneando a próxima parte.`);
          setPartsInfo({ read: data.partsRead, total: data.totalParts });
        }
      } else {
        // Validation or context error
        let displayError = data.message || data.error || 'Erro desconhecido ao processar QR.';
        
        // Translating technical codes to user-friendly messages
        if (data.error === 'ELECTION_CONTEXT_MISMATCH') {
          displayError = `Pleito ou Turno Incompatível: O Boletim lido não pertence à eleição ativa no momento.`;
        } else if (data.error === 'INVALID_VOTE_DATA' || data.error === 'INVALID_QR') {
          displayError = `QR Inválido: Não foi possível decodificar os dados eleitorais deste QR Code.`;
        }
        
        setErrorMsg(displayError);
        setStatus('Aguardando leitura...');
        // Allow scanning the same code again if it was a temporary error, but wait a bit
        setTimeout(() => {
          processedRef.current.delete(decodedText);
        }, 3000);
      }
    } catch (err) {
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
    // Only init scanner if sessionId is set (to avoid double init)
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
  }, [sessionId]); // re-bind when session changes

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      void processQrContent(manualInput.trim());
      setManualInput('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="bg-blue-900 text-white shadow-md p-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-tight">Apuração Paralela 2026</h1>
          <p className="text-blue-200 text-sm font-medium">Painel do Operador</p>
        </div>
        <div className="flex gap-4">
          <a href="/apuracao" target="_blank" rel="noreferrer" className="text-sm bg-blue-800 hover:bg-blue-700 px-3 py-1 rounded text-white border border-blue-700">
            Ver Painel Público
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-6 flex flex-col items-center">
        <div className="w-full bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
          <div className="bg-gray-100 border-b p-4 text-center">
            <h2 className="text-2xl font-black text-gray-800 uppercase tracking-widest">Ler Boletim de Urna</h2>
            <p className="text-gray-500 text-sm mt-1">Aponte a câmera para o QR Code impresso no final do Boletim</p>
          </div>
          
          <div className="p-4 flex flex-col items-center">
            {errorMsg && (
              <div className="w-full bg-red-100 border-l-4 border-red-600 text-red-800 p-4 mb-6 rounded shadow-sm">
                <div className="flex items-start">
                  <svg className="w-6 h-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h3 className="font-bold">Atenção</h3>
                    <p className="font-medium text-sm mt-1">{errorMsg}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="w-full max-w-lg mx-auto bg-black rounded overflow-hidden shadow-inner mb-6 relative">
              <div id="reader" className="w-full [&>div]:!border-none [&_video]:!object-cover"></div>
              {isProcessing && (
                <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center z-10">
                  <div className="text-white text-center">
                    <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="font-bold">Processando...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="w-full max-w-lg mx-auto mb-2 text-center">
              <p className={`text-lg font-bold ${status.includes('Completo') ? 'text-green-600' : 'text-blue-900'}`}>
                {status}
              </p>
            </div>

            {partsInfo && (
              <div className="w-full max-w-lg mx-auto bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h3 className="font-bold text-blue-900 uppercase text-sm mb-3">Boletim em Leitura (Multipart)</h3>
                <div className="space-y-2">
                  {Array.from({ length: partsInfo.total }).map((_, i) => (
                    <div key={i} className="flex items-center">
                      <div className={`w-6 h-6 flex items-center justify-center rounded-full mr-3 ${i < partsInfo.read ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                        {i < partsInfo.read ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="text-xs font-bold">{i + 1}</span>
                        )}
                      </div>
                      <span className={`font-medium ${i < partsInfo.read ? 'text-green-700' : 'text-gray-500'}`}>
                        QR Code {i + 1} {i < partsInfo.read ? 'Lido' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 text-center text-sm font-bold text-blue-800 bg-blue-100 py-1 rounded">
                  {partsInfo.read} de {partsInfo.total} partes recebidas
                </div>
              </div>
            )}
            
            <div className="w-full max-w-lg mt-4">
              <button 
                onClick={resetSession}
                className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded transition"
              >
                Reiniciar Leitura Atual
              </button>
            </div>
          </div>
        </div>

        <div className="w-full bg-white rounded-lg shadow-sm border p-4">
          <details className="group">
            <summary className="font-bold text-gray-600 cursor-pointer list-none flex items-center justify-between">
              <span>Entrada Manual (Alternativa / Teste)</span>
              <svg className="w-5 h-5 transition group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="mt-4 pt-4 border-t">
              <form onSubmit={handleManualSubmit} className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-gray-600">Cole o texto extraído do QR Code:</label>
                <textarea 
                  className="w-full border border-gray-300 rounded p-2 text-sm font-mono h-24 focus:ring-2 focus:ring-blue-500 outline-none"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  placeholder="Ex: QRBU:1:1:1:2:123456..."
                ></textarea>
                <button 
                  type="submit" 
                  disabled={!manualInput.trim() || isProcessing}
                  className="bg-gray-800 text-white font-bold py-2 rounded hover:bg-gray-900 disabled:opacity-50"
                >
                  Enviar Código Manual
                </button>
              </form>
            </div>
          </details>
        </div>
      </main>
    </div>
  );
}

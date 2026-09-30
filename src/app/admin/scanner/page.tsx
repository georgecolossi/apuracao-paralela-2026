'use client';

import { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useRouter } from 'next/navigation';

export default function ScannerPage() {
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Aguardando leitura...');
  const [partsInfo, setPartsInfo] = useState<{ read: number, total: number } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    async function onScanSuccess(decodedText: string) {
      if (scanResult === decodedText) return; // evita leitura repetida
      setScanResult(decodedText);
      setStatus('Processando leitura...');

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: decodedText })
        });
        
        const data = await res.json();
        
        if (data.status === 'COMPLETO') {
          setStatus('BU Completo! Redirecionando...');
          scanner.clear();
          setTimeout(() => {
            router.push(`/admin/conferir/${data.reportId}`);
          }, 1500);
        } else if (data.status === 'PARCIAL') {
          setStatus(`Parte lida. Continue escaneando. (Lidas: ${data.partsRead}/${data.totalParts})`);
          setPartsInfo({ read: data.partsRead, total: data.totalParts });
          setScanResult(null); // permite ler a próxima
        } else if (data.error) {
          setStatus(`Erro: ${data.error}`);
          setScanResult(null);
        }
      } catch (err) {
        setStatus('Erro de conexão ao processar.');
        setScanResult(null);
      }
    }

    scanner.render(onScanSuccess, () => {});

    return () => {
      scanner.clear().catch(e => console.error(e));
    };
  }, [scanResult, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
        <h1 className="text-2xl font-bold mb-4 text-center text-black">Scanner de BU (Eleições 2026)</h1>
        <div id="reader" className="w-full mb-4"></div>
        
        <div className={`p-4 rounded ${partsInfo ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}>
          <p className="font-semibold text-center text-black">{status}</p>
        </div>
      </div>
    </div>
  );
}

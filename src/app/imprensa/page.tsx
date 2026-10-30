'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, ArrowLeft, BookOpen, Activity, Newspaper } from 'lucide-react';
import { UrnasFeed } from '@/components/press/UrnasFeed';

export default function ImprensaPage() {
  const [electionParam, setElectionParam] = useState<string>('');
  const [round, setRound] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      const r = search.get('round');
      const el = search.get('election') || search.get('electionId') || search.get('slug') || '';
      if (r) {
        const parsedRound = parseInt(r, 10);
        if (!isNaN(parsedRound)) setRound(parsedRound);
      }
      if (el) {
        setElectionParam(el);
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">
      {/* Top Header */}
      <header className="bg-slate-900 text-white shadow-md border-b-4 border-indigo-600 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-sm flex items-center justify-center">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg md:text-xl font-black uppercase tracking-tight">
                  Imprensa & Rádio
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-indigo-900 text-indigo-200 border border-indigo-700">
                  Ao Vivo
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider hidden sm:block">
                Últimas Urnas e Roteiro de Locução
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/apuracao"
              className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-white border border-slate-700 transition-colors font-bold uppercase tracking-wide"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden md:inline">Painel Geral</span>
            </Link>
            <Link
              href="/metodologia"
              className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-slate-300 hover:text-white border border-slate-700 transition-colors font-bold uppercase tracking-wide"
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden md:inline">Metodologia</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Feed */}
      <main className="flex-1 max-w-5xl mx-auto p-4 md:p-6 w-full">
        <UrnasFeed initialRound={round} electionParam={electionParam} />
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 text-xs py-6 mt-12">
        <div className="max-w-5xl mx-auto px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div>
            <p className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
              Apuração Paralela 2.0 — Módulo Imprensa & Rádio
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Dados extraídos diretamente de Boletins de Urna (BU) físicos via QR Code. Auditoria cidadã independente.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-wider">
            <Link href="/apuracao" className="hover:text-indigo-400 transition-colors">
              Apuração
            </Link>
            <span className="text-slate-700">•</span>
            <Link href="/metodologia" className="hover:text-indigo-400 transition-colors">
              Metodologia
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

import Link from 'next/link';
import { Hash, AlertTriangle, FileText, Activity, ShieldAlert, BookOpen, ArrowLeft } from 'lucide-react';

export default function MetodologiaPage() {
  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">
      <header className="bg-slate-900 text-white shadow-md border-b-4 border-indigo-600">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-bold uppercase tracking-tight">Metodologia da <span className="text-indigo-400">Apuração</span></h1>
          </div>
          <Link href="/apuracao" className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-white border border-slate-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline font-bold uppercase tracking-wide">Voltar ao Painel</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto p-4 md:p-8 w-full">
        <div className="bg-white p-6 md:p-10 shadow-sm rounded-2xl border border-slate-200">
          
          <div className="bg-red-50 border border-red-200 p-5 rounded-xl mb-10 flex items-start gap-4">
            <ShieldAlert className="w-8 h-8 text-red-600 shrink-0 mt-1" />
            <div>
              <h2 className="text-lg font-black text-red-800 uppercase tracking-tight">Aviso Legal Importante</h2>
              <p className="mt-1 text-red-700 font-medium">
                Esta apuração é estritamente INDEPENDENTE. Os resultados apresentados nesta plataforma 
                <strong className="mx-1 text-red-900">NÃO</strong> 
                são a totalização oficial da Justiça Eleitoral do Brasil.
              </p>
            </div>
          </div>
          
          <div className="space-y-10 text-slate-700 text-justify">
            
            <section className="flex gap-4">
              <div className="hidden sm:flex flex-col items-center pt-1">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1 w-px bg-slate-100 my-2" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-3 flex items-center gap-2">
                  <span className="sm:hidden text-indigo-600">1.</span>
                  Origem dos Dados e Cobertura
                </h2>
                <p className="leading-relaxed">
                  Todos os dados exibidos são extraídos única e exclusivamente dos QR Codes presentes nos Boletins de Urna (BU) físicos afixados nas portas das seções eleitorais. O percentual de cobertura exibido no painel representa a proporção de urnas físicas que já foram fotografadas e submetidas ao nosso sistema em relação à quantidade de urnas totais esperadas, e, portanto, a apuração permanece por natureza <strong className="text-slate-900">PARCIAL</strong> durante toda a coleta.
                </p>
              </div>
            </section>

            <section className="flex gap-4">
              <div className="hidden sm:flex flex-col items-center pt-1">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1 w-px bg-slate-100 my-2" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-3 flex items-center gap-2">
                  <span className="sm:hidden text-indigo-600">2.</span>
                  Metodologia de Totalização
                </h2>
                <p className="leading-relaxed mb-4">
                  A totalização é um recálculo dinâmico baseado estritamente na soma dos votos de BUs com status <strong className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">PROCESSADO</strong>. BUs em verificação, rejeitados ou parciais não entram na matemática. Denominadores:
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                    <h3 className="font-bold text-slate-900 uppercase tracking-wide text-xs mb-1">Votos Válidos</h3>
                    <p className="text-sm">Soma exclusiva dos votos nominais e de legenda (partido).</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                    <h3 className="font-bold text-slate-900 uppercase tracking-wide text-xs mb-1">Brancos e Nulos</h3>
                    <p className="text-sm">Contabilizados separadamente, conforme ditames eleitorais, não compondo o percentual de votos válidos da apuração paralela.</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl sm:col-span-2">
                    <h3 className="font-bold text-slate-900 uppercase tracking-wide text-xs mb-1">Comparecimento</h3>
                    <p className="text-sm">Total de eleitores que efetivamente depositaram votos nas urnas já processadas.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="flex gap-4">
              <div className="hidden sm:flex flex-col items-center pt-1">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <Hash className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1 w-px bg-slate-100 my-2" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-3 flex items-center gap-2">
                  <span className="sm:hidden text-indigo-600">3.</span>
                  Tratamento de Duplicidades
                </h2>
                <p className="leading-relaxed">
                  O sistema utiliza identificação determinística e restrições de unicidade para impedir a contabilização duplicada de um mesmo BU nos fluxos cobertos pela implementação. Caso dois operadores bipem o mesmo Boletim de Urna em cidades diferentes simultaneamente, a plataforma aplica um algoritmo de <strong className="text-slate-900">Constraint Atômica (Deterministic ID)</strong> baseado na Hash combinada de UF, Município, Zona, Seção e Código de Urna. Apenas a primeira operação é aceita, a segunda recebe um erro de conflito amigável e é isolada (<span className="text-red-700 bg-red-50 font-bold px-1.5 py-0.5 rounded text-sm">DUPLICADO</span>).
                </p>
              </div>
            </section>
            
            <section className="flex gap-4">
              <div className="hidden sm:flex flex-col items-center pt-1">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-indigo-600" />
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-3 flex items-center gap-2">
                  <span className="sm:hidden text-indigo-600">4.</span>
                  Modo de Simulação
                </h2>
                <p className="leading-relaxed">
                  Para auditorias técnicas de fluxo, a plataforma pode operar em <strong className="text-slate-900">MODO SIMULAÇÃO</strong>. Boletins escaneados com sintaxe sintética exibem um banner de alerta inquestionável e são guardados em namespace isolado no banco de dados (<code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-bold border border-slate-200">isSimulation = true</code>). Eles não interagem ou contaminam a matemática da eleição real pública.
                </p>
              </div>
            </section>

          </div>
        </div>
      </main>
    </div>
  );
}

import Link from 'next/link';

export default function MetodologiaPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto bg-white p-8 shadow rounded text-black">
        <h1 className="text-3xl font-bold mb-6 border-b pb-2">Metodologia da Apuração Paralela 2026</h1>
        
        <div className="space-y-6 text-black text-justify">
          <section>
            <h2 className="text-xl font-bold text-red-700">Aviso Legal Importante</h2>
            <p className="mt-2 font-semibold">Esta apuração é estritamente INDEPENDENTE. Os resultados apresentados nesta plataforma NÃO são a totalização oficial da Justiça Eleitoral do Brasil.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold border-b pb-1">1. Origem dos Dados e Cobertura</h2>
            <p className="mt-2">Todos os dados exibidos são extraídos única e exclusivamente dos QR Codes presentes nos Boletins de Urna (BU) físicos afixados nas portas das seções eleitorais. O percentual de cobertura exibido no painel representa a proporção de urnas físicas que já foram fotografadas e submetidas ao nosso sistema em relação à quantidade de urnas totais esperadas, e, portanto, a apuração permanece por natureza PARCIAL durante toda a coleta.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold border-b pb-1">2. Metodologia de Totalização</h2>
            <p className="mt-2">A totalização é um recálculo dinâmico baseado estritamente na soma dos votos de BUs com status <strong>PROCESSADO</strong>. BUs em verificação, rejeitados ou parciais não entram na matemática. Denominadores:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Votos Válidos:</strong> Soma exclusiva dos votos nominais e de legenda (partido).</li>
              <li><strong>Brancos e Nulos:</strong> Contabilizados separadamente, conforme ditames eleitorais, não compondo o percentual de votos válidos para declaração de vitória.</li>
              <li><strong>Comparecimento:</strong> Total de eleitores que efetivamente depositaram votos nas urnas já processadas.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold border-b pb-1">3. Tratamento de Inconsistências e Duplicidades</h2>
            <p className="mt-2">O sistema é blindado arquiteturalmente contra &quot;Double Count&quot;. Caso dois operadores bipem o mesmo Boletim de Urna em cidades diferentes simultaneamente, a plataforma aplica um algoritmo de <em>Constraint Atômica (Deterministic ID)</em> baseado na Hash combinada de UF, Município, Zona, Seção e Código de Urna. Apenas a primeira operação é aceita, a segunda recebe um erro de conflito amigável e é isolada (DUPLICADO).</p>
          </section>
          
          <section>
            <h2 className="text-xl font-bold border-b pb-1">4. Modo de Simulação</h2>
            <p className="mt-2">Para auditorias técnicas de fluxo, a plataforma pode operar em MODO SIMULAÇÃO. Boletins escaneados com sintaxe sintética exibem um banner de alerta inquestionável e são guardados em namespace isolado no banco de dados (`isSimulation = true`). Eles jamais interagem ou contaminam a matemática da eleição real pública.</p>
          </section>
        </div>

        <div className="mt-8 border-t pt-4">
          <Link href="/apuracao" className="text-blue-600 font-bold hover:underline">
            ← Voltar ao Painel Público
          </Link>
        </div>
      </div>
    </div>
  );
}

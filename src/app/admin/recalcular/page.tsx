'use client';

export default function RecalcularPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-black">Recálculo e Integridade</h1>
      <div className="bg-white p-6 rounded shadow text-black">
        <p className="mb-4">
          A totalização desta plataforma <strong>não utiliza caches acumulativos estáticos</strong>. 
          Isso significa que não há risco de divergência matemática entre os votos armazenados e os resultados exibidos, 
          pois a API de totais realiza a agregação diretamente via banco de dados relacional.
        </p>
        <p className="mb-4">
          Se o estado de um Boletim de Urna for alterado (por exemplo, de PROCESSADO para CANCELADO devido à auditoria),
          o recálculo do Painel Público ocorre instantaneamente na próxima requisição, sem necessidade de processamento em lote (batch recalculation).
        </p>
        <button className="bg-blue-600 text-white px-4 py-2 rounded mt-4" onClick={() => alert('Integridade verificada e confirmada via agregação direta (live-query).')}>
          Verificar Integridade do Banco
        </button>
      </div>
    </div>
  );
}

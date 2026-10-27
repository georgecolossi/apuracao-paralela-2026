import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import CoverageManager from './CoverageManager';

export default async function CoberturaPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated || auth.user.role !== 'ADMIN') {
    redirect('/admin');
  }

  // Busca cobertura contextual da eleição ativa via ElectionScope
  const activeElection = await prisma.election.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      scopes: {
        where: { scopeType: 'MUNICIPAL', isCoverageArea: true }
      }
    }
  });

  const coveredMuniIds = new Set(
    activeElection?.scopes.map(s => s.municipalityId).filter(Boolean)
  );

  // Busca todos os municípios cadastrados
  const rawMunicipalities = await prisma.municipality.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, officialCode: true, isCoverage: true, state: { select: { abbreviation: true } } }
  });

  const municipalities = rawMunicipalities.map(m => ({
    ...m,
    isCoverage: activeElection ? coveredMuniIds.has(m.id) : m.isCoverage
  }));

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Cobertura Geográfica</h1>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <p className="text-slate-600 mb-6">
          A apuração tem Concórdia/SC selecionada como padrão. Você pode adicionar municípios vizinhos caso a rádio confirme a cobertura estendida. QRBUs fora dos municípios selecionados serão bloqueados pelo scanner.
        </p>
        
        <CoverageManager initialMunicipalities={municipalities} />
      </div>
    </div>
  );
}

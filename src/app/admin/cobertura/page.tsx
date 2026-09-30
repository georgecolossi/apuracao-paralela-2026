import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import CoverageManager from './CoverageManager';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default async function CoberturaPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated || auth.user.role !== 'ADMIN') {
    redirect('/admin');
  }

  // Busca todos os municípios de SC (que foram importados)
  const municipalities = await prisma.municipality.findMany({
    where: { state: { abbreviation: 'SC' } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, officialCode: true, isCoverage: true }
  });

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Cobertura Geográfica</h1>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          A apuração tem Concórdia/SC selecionada como padrão. Você pode adicionar municípios vizinhos caso a rádio confirme a cobertura estendida. QRBUs fora dos municípios selecionados serão bloqueados pelo scanner.
        </p>
        
        <CoverageManager initialMunicipalities={municipalities} />
      </div>
    </div>
  );
}

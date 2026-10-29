import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated || auth.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const activeElection = await prisma.election.findFirst({
      where: { status: 'ACTIVE' },
      include: {
        rounds: {
          orderBy: { roundNumber: 'asc' }
        }
      }
    });

    if (!activeElection) {
      return NextResponse.json({ election: null, rounds: [] });
    }

    return NextResponse.json({
      election: {
        id: activeElection.id,
        name: activeElection.name,
        year: activeElection.year,
        status: activeElection.status,
      },
      rounds: activeElection.rounds.map(r => ({
        id: r.id,
        roundNumber: r.roundNumber,
        status: r.status,
        plei: r.plei
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao listar turnos.' }, { status: 500 });
  }
}

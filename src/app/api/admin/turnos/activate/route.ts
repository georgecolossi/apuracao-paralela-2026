import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated || auth.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
    }

    const targetRoundId = payload.roundId;
    if (!targetRoundId) {
      return NextResponse.json({ error: 'ID do turno não informado.' }, { status: 400 });
    }

    const activeElections = await prisma.election.findMany({
      where: { status: 'ACTIVE' },
      include: { rounds: true }
    });

    if (activeElections.length !== 1) {
      return NextResponse.json({ error: 'Configuração ambígua: deve haver exatamente UMA eleição ativa.' }, { status: 500 });
    }
    const election = activeElections[0];

    const targetRound = election.rounds.find(r => r.id === targetRoundId);
    if (!targetRound) {
      return NextResponse.json({ error: 'Turno alvo não encontrado nesta eleição.' }, { status: 404 });
    }

    if (targetRound.status !== 'PLANNED') {
      return NextResponse.json({ error: 'O turno alvo não está em estado PLANNED.' }, { status: 400 });
    }

    const currentActiveRounds = election.rounds.filter(r => r.status === 'ACTIVE');
    if (currentActiveRounds.length > 1) {
      return NextResponse.json({ error: 'Configuração ambígua: múltiplos turnos ativos.' }, { status: 500 });
    }

    // Executa a transação
    await prisma.$transaction(async (tx) => {
      // Se houver um round ativo, finaliza-o
      if (currentActiveRounds.length === 1) {
        await tx.electionRound.update({
          where: { id: currentActiveRounds[0].id },
          data: { status: 'FINISHED' }
        });
      }

      // Ativa o alvo
      await tx.electionRound.update({
        where: { id: targetRound.id },
        data: { status: 'ACTIVE' }
      });

      // Registra no log se existir
      try {
        await tx.auditLog.create({
          data: {
            action: 'TURN_ACTIVATED',
            identifiers: JSON.stringify({
              action: 'TURN_ACTIVATED',
              electionId: election.id,
              previousRoundId: currentActiveRounds.length === 1 ? currentActiveRounds[0].id : null,
              newRoundId: targetRound.id,
              newRoundNumber: targetRound.roundNumber
            }),
            userId: auth.user?.userId || null,
            result: 'SUCCESS'
          }
        });
      } catch (e) {
        // Ignora se AuditLog não estiver estruturado assim
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

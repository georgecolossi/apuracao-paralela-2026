import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Proibido' }, { status: 403 });
    }

    // This is the global operational reset toggle.
    if (process.env.ALLOW_OPERATIONAL_RESET !== 'true') {
      return NextResponse.json({ error: 'Reset desabilitado neste ambiente operacional.' }, { status: 403 });
    }

    let body: { confirmationText?: string, roundId?: string } = {};
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
    }

    const { confirmationText, roundId } = body;
    
    const expected = "ZERAR APURAÇÃO";
    if (!confirmationText || confirmationText.trim().toUpperCase() !== expected) {
      return NextResponse.json({ error: 'Confirmação incorreta' }, { status: 400 });
    }

    if (!roundId) {
      return NextResponse.json({ error: 'ID do turno é obrigatório para o reset' }, { status: 400 });
    }

    const round = await prisma.electionRound.findUnique({ where: { id: roundId }, include: { election: true } });
    if (!round) {
      return NextResponse.json({ error: 'Turno não encontrado' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      // Find all report IDs for this round
      const reports = await tx.ballotReport.findMany({ where: { roundId }, select: { id: true } });
      const reportIds = reports.map(r => r.id);
      
      // Delete votes linked to these reports
      if (reportIds.length > 0) {
        await tx.ballotVote.deleteMany({ where: { reportId: { in: reportIds } } });
        
        // Delete the reports themselves
        await tx.ballotReport.deleteMany({ where: { roundId } });
      }

      await tx.auditLog.create({
        data: {
          action: 'ROUND_RESET',
          result: 'SUCCESS',
          identifiers: 'Reset do Turno ' + round.roundNumber,
          userId: auth.user.userId
        }
      });
    });

    return NextResponse.json({ status: 'SUCCESS' });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Erro ao zerar sistema' }, { status: 500 });
  }
}

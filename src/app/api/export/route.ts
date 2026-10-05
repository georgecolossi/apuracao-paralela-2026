import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';

export async function GET(req: Request) {
  const auth = await requireAuthenticatedUser();
  
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (auth.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') || 'json';
  const roundParam = searchParams.get('round');

  const activeElections = await prisma.election.findMany({
    where: { status: 'ACTIVE' },
    include: { rounds: true }
  });

  if (activeElections.length === 0) {
    return NextResponse.json({ error: 'Nenhuma eleição ativa.' }, { status: 400 });
  }
  if (activeElections.length > 1) {
    return NextResponse.json({ error: 'Múltiplas eleições ativas configuradas.' }, { status: 500 });
  }
  const election = activeElections[0];

  let targetRound = null;

  if (roundParam) {
    const rNum = parseInt(roundParam, 10);
    targetRound = election.rounds.find(r => r.roundNumber === rNum);
    if (!targetRound) {
      return NextResponse.json({ error: 'Turno especificado não encontrado nesta eleição.' }, { status: 400 });
    }
  } else {
    const activeRounds = election.rounds.filter(r => r.status === 'ACTIVE');
    if (activeRounds.length === 0) {
      return NextResponse.json({ error: 'Nenhum turno ativo encontrado.' }, { status: 400 });
    }
    if (activeRounds.length > 1) {
      return NextResponse.json({ error: 'Múltiplos turnos ativos configurados.' }, { status: 500 });
    }
    targetRound = activeRounds[0];
  }

  const reports = await prisma.ballotReport.findMany({
    where: { 
      electionId: election.id,
      roundId: targetRound.id,
      status: 'PROCESSADO', 
      isSimulation: false 
    },
    include: { votes: { include: { office: true } } }
  });

  if (format === 'csv') {
    let csv = 'Estado,Municipio,Zona,Secao,Urna,Cargo,Candidato/Partido,Votos\n';
    for (const rep of reports) {
      for (const v of rep.votes) {
        csv += `${rep.stateCode},${rep.cityCode},${rep.zoneCode},${rep.sectionCode},${rep.urnCode},${v.office.name},${v.voteType},${v.quantity}\n`;
      }
    }
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="export_bu_T${targetRound.roundNumber}.csv"`
      }
    });
  }

  return NextResponse.json(reports);
}

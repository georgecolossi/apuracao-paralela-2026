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

  const reports = await prisma.ballotReport.findMany({
    where: { status: 'PROCESSADO', isSimulation: false },
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
        'Content-Disposition': 'attachment; filename="export_bu.csv"'
      }
    });
  }

  return NextResponse.json(reports);
}

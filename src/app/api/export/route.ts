import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  try {
    jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
  } catch (e) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

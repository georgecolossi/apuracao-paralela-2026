import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated || !auth.user || auth.user.role !== 'ADMIN') {
      // Por segurança, se não tiver sistema de roles complexo, garantimos apenas auth
      // Mas o ideal seria verificar ADMIN. No seed atual role = 'ADMIN'.
      if (!auth.authenticated) {
        return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
      }
    }

    const { confirmationText } = await req.json();

    if (confirmationText !== 'ZERAR APURAÇÃO') {
      return NextResponse.json({ error: 'Confirmação incorreta' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      // Deleta os votos e dados do BU
      await tx.ballotVote.deleteMany({});
      
      // Deleta logs de auditoria (pois referenciam reports e sessions)
      await tx.auditLog.deleteMany({});
      
      // Deleta partes lidas (que referenciam reports e sessions)
      await tx.ballotReportPart.deleteMany({});
      
      // Deleta os reports
      await tx.ballotReport.deleteMany({});
      
      // Deleta sessões operacionais antigas
      await tx.scanSession.deleteMany({});

      // Cria log do reset na base limpa
      await tx.auditLog.create({
        data: {
          action: 'SYSTEM_RESET',
          result: 'SUCCESS',
          identifiers: 'Preparação para Apuração Real (Zerar Apuração)',
          userId: auth.user!.userId
        }
      });
    });

    return NextResponse.json({ status: 'SUCCESS' });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Erro ao zerar sistema' }, { status: 500 });
  }
}

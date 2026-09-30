import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { realtimeEmitter } from '@/lib/realtime';

import { requireAuthenticatedUser } from '@/lib/auth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const report = await prisma.ballotReport.findUnique({ where: { id } });
    
    if (!report || report.status !== 'PENDENTE_CONFIRMACAO') {
      return NextResponse.json({ error: 'BU inválido ou já processado' }, { status: 400 });
    }

    // Transação de confirmação e auditoria
    await prisma.$transaction(async (tx) => {
      await tx.ballotReport.update({
        where: { id: report.id },
        data: { status: 'PROCESSADO' }
      });

      await tx.auditLog.create({
        data: {
          action: 'CONFIRM_BU',
          reportId: report.id,
          result: 'SUCCESS',
          previousStatus: 'PENDENTE_CONFIRMACAO',
          newStatus: 'PROCESSADO'
        }
      });
    });

    // TODO: Publish Realtime Event here
    realtimeEmitter.emit('update', { type: 'BU_PROCESSED', reportId: report.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

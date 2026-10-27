import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { realtimeEmitter } from '@/lib/realtime';

import { requireAuthenticatedUser } from '@/lib/auth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (auth.user.role === 'VIEWER') {
      return NextResponse.json({
        error: 'FORBIDDEN_ROLE',
        message: 'Acesso negado: usuários com perfil de visualizador (VIEWER) não possuem permissão de confirmação de BUs.'
      }, { status: 403 });
    }

    const { id } = await params;
    const report = await prisma.ballotReport.findUnique({ where: { id } });
    
    if (!report || report.status !== 'PENDENTE_CONFIRMACAO') {
      return NextResponse.json({ error: 'BU inválido ou já processado' }, { status: 400 });
    }

    const secVariants = Array.from(new Set([report.sectionCode, report.sectionCode.padStart(4, '0'), parseInt(report.sectionCode, 10).toString()]));
    const zoneVariants = Array.from(new Set([report.zoneCode, report.zoneCode.padStart(4, '0'), parseInt(report.zoneCode, 10).toString()]));

    const sectionInDB = await prisma.pollingSection.findFirst({
      where: {
        sectionNumber: { in: secVariants },
        zone: {
          zoneNumber: { in: zoneVariants },
          municipality: { officialCode: report.cityCode }
        }
      }
    });

    if (!sectionInDB) {
      return NextResponse.json({ 
        error: 'SECTION_NOT_FOUND', 
        message: 'Seção eleitoral não encontrada na base de cobertura.' 
      }, { status: 403 });
    }

    const coverage = await prisma.roundCoverage.findUnique({
      where: {
        electionRoundId_pollingSectionId: {
          electionRoundId: report.roundId,
          pollingSectionId: sectionInDB.id
        }
      }
    });

    if (!coverage || coverage.expectedBUs <= 0) {
      return NextResponse.json({
        error: 'SECTION_INELIGIBLE_FOR_CONFIRMATION',
        message: 'Esta seção eleitoral não possui cobertura positiva (expectedBUs <= 0) e não pode ser confirmada para totalização.'
      }, { status: 403 });
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
          userId: auth.user.userId,
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

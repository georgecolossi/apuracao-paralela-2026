import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    
    // 1. Verificar autenticação
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Verificar permissão de ADMIN
    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Proibido' }, { status: 403 });
    }

    // 3. Interlock Operacional (FAIL-CLOSED)
    if (process.env.ALLOW_OPERATIONAL_RESET !== 'true') {
      return NextResponse.json({ error: 'Reset desabilitado neste ambiente operacional.' }, { status: 403 });
    }

    // 4. Verificar payload de confirmação (strict)
    let body: { confirmationText?: string } = {};
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
    }

    const { confirmationText } = body;

    if (confirmationText !== 'ZERAR APURAÇÃO') {
      return NextResponse.json({ error: 'Confirmação incorreta' }, { status: 400 });
    }

    // 4. Executar transação de limpeza
    await prisma.$transaction(async (tx) => {
      // Ordem de deleção respeitando FKs (Votos -> Partes -> Relatórios -> Sessões)
      await tx.ballotVote.deleteMany({});
      await tx.ballotReportPart.deleteMany({});
      
      // AuditLog referencia BallotReport e ScanSession opcionalmente, 
      // então é mais seguro apagar os logs antigos antes de apagar os relatórios
      await tx.auditLog.deleteMany({});
      
      await tx.ballotReport.deleteMany({});
      await tx.scanSession.deleteMany({});

      // Cria log do reset APÓS a limpeza, garantindo que seja o primeiro log
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

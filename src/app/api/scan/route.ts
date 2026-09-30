import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Tse2026BallotReportParser } from '@/lib/parser/Tse2026BallotReportParser';
import { Tse2026SimulationParser } from '@/lib/parser/Tse2026SimulationParser';

import { requireAuthenticatedUser } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { content, isSimulation = false, sessionId } = await req.json();
    const operatorId = auth.user.userId;

    const parser = isSimulation ? new Tse2026SimulationParser() : new Tse2026BallotReportParser();

    const partInfo = parser.parsePart(content);
    if ('code' in partInfo) {
      return NextResponse.json({ error: partInfo.code || partInfo.message }, { status: 400 });
    }

    const { partIndex, totalParts, payload } = partInfo;
    const sequenceId = sessionId || partInfo.sequenceId;

    // Resolve ScanSession
    let session = await prisma.scanSession.findUnique({
      where: { sequenceId }
    });

    if (!session) {
      session = await prisma.scanSession.create({
        data: {
          sequenceId,
          expectedParts: totalParts,
          operatorId,
          isSimulation
        }
      });
    }

    // Ignore duplicate part
    const existingPart = await prisma.ballotReportPart.findUnique({
      where: {
        sessionId_partIndex: {
          sessionId: session.id,
          partIndex
        }
      }
    });

    const crypto = require('crypto');
    const contentHashStr = crypto.createHash('sha256').update(content).digest('hex');

    if (!existingPart) {
      await prisma.ballotReportPart.create({
        data: {
          sessionId: session.id,
          partIndex,
          totalParts,
          rawContent: content, // Full content with QRBU header
          contentHash: contentHashStr,
        }
      });
    }

    // Verifica completude
    const partsCount = await prisma.ballotReportPart.count({
      where: { sessionId: session.id }
    });

    if (partsCount < totalParts) {
      return NextResponse.json({
        status: 'PARCIAL',
        partsRead: partsCount,
        totalParts
      });
    }

    // Reconstruir o BU inteiro e extrair dados
    const allParts = await prisma.ballotReportPart.findMany({
      where: { sessionId: session.id },
      orderBy: { partIndex: 'asc' }
    });

    const rawPartsArray = allParts.map(p => p.rawContent);
    const fullPayloadOrError = parser.reconstruct(rawPartsArray);
    if (typeof fullPayloadOrError !== 'string') {
      return NextResponse.json({ error: fullPayloadOrError.code }, { status: 400 });
    }
    
    const reportData = parser.parseReport(fullPayloadOrError, rawPartsArray);

    if ('code' in reportData) {
      await prisma.scanSession.update({
        where: { id: session.id },
        data: { status: 'ERROR' }
      });
      return NextResponse.json({ error: reportData.code }, { status: 400 });
    }

    const { buildBallotReportIdentity } = require('@/lib/identity');
    // Determina DeterministicID real a partir do parser
    const { stateCode, cityCode, zoneCode, sectionCode, urnCode } = reportData;
    const deterministicId = buildBallotReportIdentity({ stateCode, cityCode, zoneCode, sectionCode, urnCode });

    // Checar Duplicidade real
    const duplicate = await prisma.ballotReport.findUnique({
      where: { deterministicId }
    });

    if (duplicate) {
      // Já existe. Lida com a duplicidade concorrente ou sequencial.
      return NextResponse.json({
        status: 'DUPLICADO',
        reportId: duplicate.id,
        error: 'Este Boletim de Urna já foi processado ou está na fila.'
      }, { status: 409 });
    }

    // Tentar criar via Transação para previnir condição de corrida exata no mesmo milissegundo.
    let reportId: string;
    try {
      const activeElection = await prisma.election.findFirst({ where: { status: 'ACTIVE' }, include: { rounds: true }});
      const activeRound = activeElection?.rounds[0]?.id || 'unknown';

      const result = await prisma.$transaction(async (tx) => {
        const newReport = await tx.ballotReport.create({
          data: {
            deterministicId,
            electionId: activeElection?.id || reportData.electionId,
            roundId: activeRound,
            stateCode,
            cityCode,
            zoneCode,
            sectionCode,
            urnCode,
            hash: reportData.hash || '',
            signature: reportData.signature || '',
            status: 'PENDENTE_CONFIRMACAO',
            validationData: JSON.stringify({ 
              parsed: true, 
              hashStatus: reportData.hashStatus, 
              sigStatus: reportData.sigStatus 
            }),
            metadata: sequenceId,
            isSimulation: session!.isSimulation,
            operatorId: session!.operatorId
          }
        });

        for (const vote of reportData.votes) {
           let office = await tx.office.findFirst({ where: { name: vote.officeName }});
           if (!office) {
              office = await tx.office.create({ data: { name: vote.officeName, orderNumber: 1 } });
           }
           await tx.ballotVote.create({
             data: {
               reportId: newReport.id,
               officeId: office.id,
               candidateNumber: vote.candidateNumber,
               partyNumber: vote.partyNumber,
               voteType: vote.type,
               quantity: vote.quantity
             }
           });
        }

        await tx.scanSession.update({
          where: { id: session!.id },
          data: { status: 'COMPLETED' }
        });

        return newReport.id;
      });
      reportId = result;
    } catch (dbError: any) {
      if (dbError.code === 'P2002') {
         // Caiu na malha fina da concorrência exata (mesmo milissegundo)
         const dup = await prisma.ballotReport.findUnique({ where: { deterministicId } });
         return NextResponse.json({
            status: 'DUPLICADO',
            reportId: dup?.id,
            error: 'Este Boletim de Urna foi processado simultaneamente por outro operador.'
          }, { status: 409 });
      }
      throw dbError;
    }

    return NextResponse.json({ status: 'COMPLETO', reportId });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro interno ao processar QR' }, { status: 500 });
  }
}

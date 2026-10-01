import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { coverageCodes } = body;

    if (!Array.isArray(coverageCodes) || !coverageCodes.every(c => typeof c === 'string')) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const dedupedCodes = Array.from(new Set(coverageCodes)).sort();

    if (dedupedCodes.length > 0) {
      const validMunicipalities = await prisma.municipality.findMany({
        where: {
          officialCode: { in: dedupedCodes }
        }
      });
      
      if (validMunicipalities.length !== dedupedCodes.length) {
        return NextResponse.json({ error: 'Invalid municipalities' }, { status: 400 });
      }
    }

    const oldCoverage = await prisma.municipality.findMany({
      where: { isCoverage: true },
      select: { officialCode: true }
    });
    const oldCodes = oldCoverage.map(m => m.officialCode).sort();

    const removedCodes = oldCodes.filter(c => !dedupedCodes.includes(c));

    if (removedCodes.length > 0) {
      const reportsInRemoved = await prisma.ballotReport.findFirst({
        where: {
          cityCode: { in: removedCodes },
          isSimulation: false,
          status: 'PROCESSADO'
        }
      });
      if (reportsInRemoved) {
        return NextResponse.json({ 
          error: 'CONFLITO_DADOS_REAIS',
          message: 'Não é possível remover da cobertura um município que já possui BUs reais processados.' 
        }, { status: 409 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.municipality.updateMany({
        where: { isCoverage: true },
        data: { isCoverage: false }
      });

      if (dedupedCodes.length > 0) {
        await tx.municipality.updateMany({
          where: { officialCode: { in: dedupedCodes } },
          data: { isCoverage: true }
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'UPDATE_COVERAGE',
          result: 'SUCCESS',
          identifiers: `before=${oldCodes.join(',')};after=${dedupedCodes.join(',')}`,
          userId: auth.user.userId
        }
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating coverage:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

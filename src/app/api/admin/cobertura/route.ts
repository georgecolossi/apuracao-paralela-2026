import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated || auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { coverageCodes } = body;

    if (!Array.isArray(coverageCodes)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Primeiro, limpa toda a cobertura existente
    await prisma.municipality.updateMany({
      where: { isCoverage: true },
      data: { isCoverage: false }
    });

    // Depois, seta a cobertura para os novos códigos
    if (coverageCodes.length > 0) {
      await prisma.municipality.updateMany({
        where: { officialCode: { in: coverageCodes } },
        data: { isCoverage: true }
      });
    }

    // Auditoria
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_COVERAGE',
        result: 'SUCCESS',
        identifiers: coverageCodes.join(','),
        userId: auth.user.userId
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating coverage:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedTestContext() {
  const adminEmail = 'admin@apuracao.local';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    admin = await prisma.user.create({
      data: {
        name: 'Administrador de Testes',
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        isActive: true
      }
    });
  }

  // Eleição oficial de fixture para testes E2E e de integração
  const electionDb = await prisma.election.findFirst({ where: { plei: '2110' } });
  if (!electionDb) {
    const election = await prisma.election.create({
      data: {
        slug: 'eleicao-oficial-tse-2026-fixture',
        plei: '2110',
        name: 'Eleição Oficial TSE 2026 (Fixture)',
        year: 2026,
        description: 'Pleito de fixture para suíte de testes de regressão',
        status: 'ACTIVE',
        rounds: {
          create: [
            { roundNumber: 1, plei: '2110', status: 'ACTIVE' },
            { roundNumber: 2, plei: '6258', status: 'PLANNED' }
          ]
        }
      }
    });
    console.log('Eleição de testes (2110) configurada:', election.id);
  }

  // Estado e Município padrão de testes
  let state = await prisma.state.findUnique({ where: { abbreviation: 'SP' } });
  if (!state) {
    state = await prisma.state.create({
      data: { name: 'São Paulo', abbreviation: 'SP' }
    });
  }

  const city = await prisma.municipality.findUnique({ where: { officialCode: '71072' } });
  if (!city) {
    await prisma.municipality.create({
      data: { name: 'São Paulo', officialCode: '71072', stateId: state.id, isCoverage: true }
    });
  }

  console.log('Seed de testes concluído.');
}

if (process.argv[1]?.endsWith('test-seed.ts')) {
  seedTestContext()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

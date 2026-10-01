import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const adminEmail = 'admin@apuracao.local';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    admin = await prisma.user.create({
      data: {
        name: 'Administrador Padrão',
        email: adminEmail,
        passwordHash,
        role: 'ADMIN'
      }
    });
  }

  // Usar 2110 (TSE Oficial Turno 1) em vez do mock 123
  // Isso evita ter múltiplas eleições ACTIVE gerando ambiguidade no /api/totals
  const electionDb = await prisma.election.findFirst({ where: { plei: '2110' }});
  if (!electionDb) {
    const election = await prisma.election.create({
      data: {
        plei: '2110',
        name: 'Eleição Oficial TSE 2026 (Fixture)',
        year: 2026,
        description: 'Pleito correspondente aos payloads oficiais TSE para testes físicos E2E',
        status: 'ACTIVE',
        rounds: {
          create: [
            { roundNumber: 1, status: 'ACTIVE' },
            { roundNumber: 2, status: 'PLANNED' }
          ]
        }
      }
    });
    console.log('Eleição oficial (2110) configurada:', election.id);
  } else {
    console.log('Seed (2110) já existente.');
  }

  // Idempotency check for state/city
  let state = await prisma.state.findUnique({ where: { abbreviation: 'SP' } });
  if (!state) {
    state = await prisma.state.create({
      data: { name: 'São Paulo', abbreviation: 'SP' }
    });
  }

  const city = await prisma.municipality.findUnique({ where: { officialCode: '71072' } });
  if (!city) {
    await prisma.municipality.create({
      data: { name: 'São Paulo', officialCode: '71072', stateId: state.id }
    });
  }

  console.log('Seed concluído.');
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

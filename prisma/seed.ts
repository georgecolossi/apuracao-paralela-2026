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

  const electionDb = await prisma.election.findFirst();
  if (electionDb) {
    console.log('Seed already ran.');
    return;
  }

  const election = await prisma.election.create({
    data: {
      name: 'Eleições Gerais 2026',
      year: 2026,
      description: 'Eleição para Presidente, Governador, Senador, Deputado Federal e Estadual',
      status: 'ACTIVE',
      rounds: {
        create: [
          { roundNumber: 1, status: 'ACTIVE' },
          { roundNumber: 2, status: 'PLANNED' }
        ]
      }
    }
  });

  const state = await prisma.state.create({
    data: { name: 'São Paulo', abbreviation: 'SP' }
  });

  const city = await prisma.municipality.create({
    data: { name: 'São Paulo', officialCode: '71072', stateId: state.id }
  });

  console.log('Banco populado com dados básicos de eleição:', election.id);
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

import { prisma } from './src/lib/db';

async function seedCoverage() {
  const stateSP = await prisma.state.upsert({
    where: { abbreviation: 'SP' },
    update: {},
    create: { name: 'SÃO PAULO', abbreviation: 'SP' }
  });
  
  await prisma.municipality.upsert({
    where: { officialCode: '71072' },
    update: { isCoverage: true },
    create: { name: 'SÃO PAULO', officialCode: '71072', stateId: stateSP.id, isCoverage: true }
  });

  const stateAC = await prisma.state.upsert({
    where: { abbreviation: 'AC' },
    update: {},
    create: { name: 'ACRE', abbreviation: 'AC' }
  });

  await prisma.municipality.upsert({
    where: { officialCode: '01392' },
    update: { isCoverage: true },
    create: { name: 'RIO BRANCO', officialCode: '01392', stateId: stateAC.id, isCoverage: true }
  });

  const stateSC = await prisma.state.upsert({
    where: { abbreviation: 'SC' },
    update: {},
    create: { name: 'SANTA CATARINA', abbreviation: 'SC' }
  });
  
  await prisma.municipality.upsert({
    where: { officialCode: '80837' },
    update: { isCoverage: true },
    create: { name: 'CONCÓRDIA', officialCode: '80837', stateId: stateSC.id, isCoverage: true }
  });

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('admin123', 10);
  
  await prisma.user.upsert({
    where: { email: 'admin@apuracao.local' },
    update: { passwordHash, role: 'ADMIN', isActive: true },
    create: {
      name: 'Administrador E2E',
      email: 'admin@apuracao.local',
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });

  console.log('Test coverage and admin user configured.');
}

seedCoverage().catch(console.error).finally(() => prisma.$disconnect());

import fs from 'fs';
import path from 'path';
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
  
  await prisma.municipality.upsert({
    where: { officialCode: '80837' },
    update: { isCoverage: true },
    create: { name: 'CONCÓRDIA', officialCode: '80837', stateId: stateSP.id, isCoverage: true }
  });

  console.log('Test coverage configured.');
}

seedCoverage().catch(console.error).finally(() => prisma.$disconnect());

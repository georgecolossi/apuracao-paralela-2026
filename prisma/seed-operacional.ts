import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed operacional para Eleições 2026 - 1º Turno
 * PLEI: 3220 | Eleição Federal: 6257 | Eleição Estadual SC: 6259
 * Concórdia/SC - Código TSE: 80837
 *
 * IMPORTANTE: Este seed cria o contexto operacional REAL de 04/10/2026.
 * NÃO substitui o PLEI 2110 que continua existindo para fixtures de teste.
 * Execute em um banco LIMPO gerado por: npx prisma db push
 */
async function main() {
  // 1. Usuário admin operacional
  const adminEmail = 'admin@apuracao.local';
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isActive: true },
    create: {
      name: 'Administrador Padrão',
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });
  console.log('Usuário admin configurado.');

  // 2. Eleição Operacional 2026 — PLEI 3220
  // NÃO criar PLEI 2110 aqui. Fixtures de teste usam banco e2e.db isolado.
  const existingOp = await prisma.election.findFirst({ where: { plei: '3220' } });
  if (!existingOp) {
    await prisma.election.create({
      data: {
        plei: '3220',
        name: 'Eleições Gerais 2026 — 1º Turno (Operacional)',
        year: 2026,
        description: 'Pleito oficial TSE 3220 — 04/10/2026. Federal: 6257. Estadual SC: 6259.',
        status: 'ACTIVE',
        rounds: {
          create: [
            { roundNumber: 1, status: 'ACTIVE' },
            { roundNumber: 2, status: 'PLANNED' }
          ]
        }
      }
    });
    console.log('Eleição operacional (PLEI 3220) configurada.');
  } else {
    console.log('Eleição operacional (PLEI 3220) já existe.');
  }

  // 3. Estado SC
  const stateSC = await prisma.state.upsert({
    where: { abbreviation: 'SC' },
    update: {},
    create: { name: 'SANTA CATARINA', abbreviation: 'SC' }
  });

  // 4. Concórdia/SC (80837) — isCoverage SOMENTE para cobertura real
  // O campo isCoverage NÃO é setado aqui automaticamente.
  // Deve ser ativado manualmente via /admin/cobertura antes da operação.
  const concordia = await prisma.municipality.upsert({
    where: { officialCode: '80837' },
    update: {},
    create: {
      name: 'CONCÓRDIA',
      officialCode: '80837',
      stateId: stateSC.id,
      isCoverage: false  // Deve ser ativado explicitamente pelo ADMIN antes da operação
    }
  });
  console.log(`Concórdia/SC (80837) registrada. isCoverage atual: ${concordia.isCoverage}`);
  console.log('ATENÇÃO: Ative isCoverage=true via /admin/cobertura antes de iniciar a operação.');

  console.log('\nSeed operacional concluído.');
  console.log('Próximo passo: tsx scripts/import-municipalities.ts && tsx scripts/import-candidates.ts');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

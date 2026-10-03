import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed operacional para Eleições 2026 — 1º Turno
 * PLEI: 3220 | Eleição Federal: 6257 | Eleição Estadual SC: 6259
 * Concórdia/SC — Código TSE: 80837
 *
 * IMPORTANTE: Este seed cria o contexto operacional REAL de 04/10/2026.
 * NÃO substitui o PLEI 2110 que continua existindo somente para fixtures de teste.
 *
 * A credencial administrativa DEVE ser fornecida via variável de ambiente.
 * O seed falha imediatamente se ADMIN_USERNAME ou ADMIN_PASSWORD não estiverem definidos.
 *
 * PowerShell:
 *   $env:DATABASE_URL="file:./prod.db"
 *   $env:ADMIN_USERNAME="admin"
 *   $env:ADMIN_PASSWORD="senha-forte-aqui"
 *   npx tsx prisma/seed-operacional.ts
 */
async function main() {
  // 1. Validação das credenciais operacionais — FAIL-CLOSED
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || adminUsername.trim() === '') {
    console.error('ERRO: ADMIN_USERNAME não configurado.');
    console.error('Defina a credencial antes de executar o seed operacional:');
    console.error('  PowerShell: $env:ADMIN_USERNAME="admin"');
    process.exit(1);
  }

  if (!adminPassword || adminPassword.trim() === '') {
    console.error('ERRO: Variável de ambiente ADMIN_PASSWORD não definida.');
    console.error('Defina a credencial antes de executar o seed operacional:');
    console.error('  PowerShell: $env:ADMIN_PASSWORD="senha-forte-aqui"');
    process.exit(1);
  }

  if (adminPassword.length < 10) {
    console.error('ERRO: ADMIN_PASSWORD deve ter pelo menos 10 caracteres.');
    process.exit(1);
  }

  // 2. Hash bcrypt da senha (nunca armazenada em plaintext, nunca impressa)
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  
  // User.email é mantido como identificador de login para evitar migração
  // estrutural antes da operação.
  await prisma.user.upsert({
    where: { email: adminUsername },
    update: { passwordHash, isActive: true, role: 'ADMIN' },
    create: {
      name: 'Administrador Operacional',
      email: adminUsername,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });
  console.log(`Usuário administrador configurado: ${adminUsername}`);

  // 3. Eleição Operacional 2026 — PLEI 3220
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

  // 4. Estado SC
  const stateSC = await prisma.state.upsert({
    where: { abbreviation: 'SC' },
    update: {},
    create: { name: 'SANTA CATARINA', abbreviation: 'SC' }
  });

  // 5. Concórdia/SC (80837) — isCoverage=false até confirmação manual do ADMIN
  // O campo isCoverage NÃO é ativado automaticamente.
  // O ADMIN deve acessar /admin/cobertura e habilitar Concórdia/80837 explicitamente.
  const concordia = await prisma.municipality.upsert({
    where: { officialCode: '80837' },
    update: {},
    create: {
      name: 'CONCÓRDIA',
      officialCode: '80837',
      stateId: stateSC.id,
      isCoverage: false
    }
  });
  console.log(`Concórdia/SC (80837) registrada. isCoverage=${concordia.isCoverage}`);
  console.log('ATENÇÃO: isCoverage=false. Ative manualmente via /admin/cobertura antes da operação.');

  // 6. Verificação de sanidade: PLEI 2110 NÃO deve existir neste banco
  const fixture = await prisma.election.findFirst({ where: { plei: '2110' } });
  if (fixture) {
    console.error('ERRO FATAL: PLEI 2110 (fixture de teste) encontrado neste banco!');
    console.error('Este banco NÃO é um banco operacional limpo.');
    console.error('A preparação foi interrompida para evitar contaminação.');
    process.exit(1);
  }

  console.log('\nSeed operacional concluído.');
  console.log('Próximos passos:');
  console.log('  npx tsx scripts/import-municipalities.ts');
  console.log('  npx tsx scripts/import-candidates.ts');
  console.log('  Acessar /admin/cobertura e ativar Concórdia/80837');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

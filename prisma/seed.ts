import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  
  const envEmail = process.env.INITIAL_ADMIN_EMAIL;
  const envPassword = process.env.INITIAL_ADMIN_PASSWORD;

  if (adminCount === 0 && envEmail && envPassword) {
    const passwordHash = await bcrypt.hash(envPassword, 10);
    const admin = await prisma.user.create({
      data: {
        name: process.env.INITIAL_ADMIN_NAME || 'Administrador',
        email: envEmail.trim().toLowerCase(),
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      }
    });
    console.log(`[SEED] Administrador inicial configurado com sucesso via variáveis de ambiente (${admin.email}).`);
  } else if (adminCount === 0) {
    console.log('[SEED] Banco inicializado em estado virgem. A criação do primeiro administrador deve ser realizada pelo setup seguro (/api/setup ou script CLI).');
  } else {
    console.log('[SEED] Banco já possui administrador configurado. Nenhuma ação necessária.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

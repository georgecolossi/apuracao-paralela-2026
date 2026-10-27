#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const email = args[0] || process.env.INITIAL_ADMIN_EMAIL;
  const password = args[1] || process.env.INITIAL_ADMIN_PASSWORD;
  const name = args[2] || process.env.INITIAL_ADMIN_NAME || 'Administrador Inicial';

  if (!email || !password) {
    console.error('Uso: node scripts/create-initial-admin.mjs <email> <senha> [nome]');
    console.error('Ou defina as variáveis de ambiente: INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Erro: A senha deve conter no mínimo 8 caracteres.');
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' }
  });

  if (existingAdmin) {
    console.error(`Erro: O sistema já possui um administrador configurado (${existingAdmin.email}).`);
    process.exit(1);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail }
  });

  if (existingUser) {
    console.error(`Erro: O e-mail ${normalizedEmail} já está em uso.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'INITIAL_ADMIN_SETUP',
      identifiers: `Email: ${admin.email}`,
      result: 'SUCCESS',
      newStatus: 'ACTIVE',
      metadata: JSON.stringify({ mechanism: 'CLI_SCRIPT' })
    }
  });

  console.log(`[SUCESSO] Administrador inicial criado com sucesso: ${admin.email} (ID: ${admin.id})`);
}

main()
  .catch((e) => {
    console.error('Erro ao criar administrador inicial:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

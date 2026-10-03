/**
 * Preparação do banco operacional para Eleições 2026.
 *
 * Este script cria prisma/prod.db a partir do zero.
 * FAIL-CLOSED: interrompe se prod.db já existir, para evitar sobrescrita acidental.
 *
 * Uso (Windows PowerShell):
 *   $env:ADMIN_USERNAME="admin"
 *   $env:ADMIN_PASSWORD="senha-forte-aqui"
 *   npm run db:setup:operacional
 *
 * O banco prod.db NÃO é versionado (.gitignore).
 * O banco dev.db NÃO é tocado por este script.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaDir = path.join(__dirname, '..', 'prisma');
const prodDbPath = path.join(prismaDir, 'prod.db');

// 1. FAIL-CLOSED: não sobrescrever prod.db existente
if (fs.existsSync(prodDbPath)) {
  console.error('ERRO: prisma/prod.db já existe!');
  console.error('Este script não sobrescreve um banco operacional existente.');
  console.error('Se desejar recriar do zero, remova manualmente o arquivo:');
  console.error(`  Remove-Item "${prodDbPath}"`);
  process.exit(1);
}

// 2. Validação antecipada das credenciais (antes de criar qualquer arquivo)
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminUsername || adminUsername.trim() === '') {
  console.error('ERRO: $env:ADMIN_USERNAME não definido na sessão PowerShell.');
  process.exit(1);
}
if (!adminPassword || adminPassword.trim() === '') {
  console.error('ERRO: $env:ADMIN_PASSWORD não definido na sessão PowerShell.');
  process.exit(1);
}
if (adminPassword.length < 10) {
  console.error('ERRO: $env:ADMIN_PASSWORD deve ter pelo menos 10 caracteres.');
  process.exit(1);
}

console.log('=== PREPARAÇÃO DO BANCO OPERACIONAL — PLEI 3220 ===');
console.log(`Banco destino: ${prodDbPath}`);
console.log(`Admin: ${adminEmail}`);

const env = {
  ...process.env,
  DATABASE_URL: 'file:./prod.db',
};

try {
  console.log('\n[1/4] Aplicando schema ao prod.db...');
  execSync('npx prisma db push', { env, stdio: 'inherit' });

  console.log('\n[2/4] Executando seed operacional (PLEI 3220)...');
  execSync('npx tsx prisma/seed-operacional.ts', { env, stdio: 'inherit' });

  console.log('\n[3/4] Importando municípios...');
  execSync('npx tsx scripts/import-municipalities.ts', { env, stdio: 'inherit' });

  console.log('\n[4/4] Importando CandidateMetadata (BR + SC)...');
  execSync('npx tsx scripts/import-candidates.ts', { env, stdio: 'inherit' });

  console.log('\n=== BANCO OPERACIONAL PRONTO ===');
  console.log('Próximo passo obrigatório antes de iniciar a operação:');
  console.log('  1. Iniciar com: $env:DATABASE_URL="file:./prod.db" ; npm run start');
  console.log('  2. Acessar /admin/cobertura');
  console.log('  3. Ativar Concórdia/SC (80837) manualmente');

} catch (error) {
  console.error('\nERRO durante a preparação do banco operacional.');
  // Limpa o arquivo parcialmente criado para não deixar estado corrompido
  if (fs.existsSync(prodDbPath)) {
    console.error('Removendo prod.db parcialmente criado...');
    try { fs.unlinkSync(prodDbPath); } catch {}
    ['prod.db-journal', 'prod.db-wal', 'prod.db-shm'].forEach(f => {
      const fp = path.join(prismaDir, f);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    });
  }
  process.exit(1);
}

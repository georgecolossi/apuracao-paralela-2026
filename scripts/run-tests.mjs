import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaDir = path.join(__dirname, '..', 'prisma');

const dbFiles = ['test.db', 'test.db-journal', 'test.db-wal', 'test.db-shm'];

function cleanupTestDatabase() {
  console.log('Cleaning up test database files...');
  for (const file of dbFiles) {
    const fullPath = path.join(prismaDir, file);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`Removed ${file}`);
      } catch (err) {
        console.error(`Failed to remove ${file}:`, err.message);
      }
    }
  }
}

// 1. Limpar ANTES
cleanupTestDatabase();

const env = { ...process.env, DATABASE_URL: 'file:./test.db' };

console.log('Running automated tests with isolated database: test.db');

let success = true;

try {
  console.log('Pushing schema to test.db...');
  execSync('npx prisma db push --skip-generate', { env, stdio: 'inherit' });
  
  // Vitest args forward
  const args = process.argv.slice(2).join(' ');
  const vitestCmd = `npx vitest run ${args} --exclude e2e`;
  console.log(`Running vitest: ${vitestCmd}`);
  
  execSync(vitestCmd, { env, stdio: 'inherit' });
} catch (error) {
  console.error('Automated tests failed');
  success = false;
} finally {
  // 6. Limpar DEPOIS
  cleanupTestDatabase();
}

if (!success) {
  process.exit(1);
}

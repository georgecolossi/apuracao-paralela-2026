import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// O Prisma resolve "file:./e2e.db" relativo ao diretório onde schema.prisma está localizado.
const prismaDir = path.join(__dirname, '..', 'prisma');
const dbFiles = ['e2e.db', 'e2e.db-journal', 'e2e.db-wal', 'e2e.db-shm'];

function cleanupE2EDatabase() {
  console.log('Cleaning up E2E database files...');
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

// 1. Clean up BEFORE execution
cleanupE2EDatabase();

const env = { ...process.env, DATABASE_URL: 'file:./e2e.db' };

console.log('Running E2E tests with isolated database: e2e.db');

let success = true;

try {
  console.log('Pushing schema to e2e.db...');
  execSync('npx prisma db push', { env, stdio: 'inherit' });
  
  console.log('Running test coverage seed...');
  execSync('npx tsx seed-test-coverage.ts', { env, stdio: 'inherit' });
  
  console.log('Running playwright...');
  execSync('npx playwright test', { env, stdio: 'inherit' });
} catch (error) {
  console.error('E2E tests failed');
  success = false;
} finally {
  // 6. Clean up AFTER execution (even on failure)
  cleanupE2EDatabase();
}

if (!success) {
  process.exit(1);
}

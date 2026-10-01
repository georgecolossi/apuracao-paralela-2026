import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const env = { ...process.env, DATABASE_URL: 'file:./e2e.db' };

console.log('Running E2E tests with isolated database: e2e.db');

try {
  console.log('Pushing schema to e2e.db...');
  execSync('npx prisma db push', { env, stdio: 'inherit' });
  
  console.log('Running test coverage seed...');
  execSync('npx tsx seed-test-coverage.ts', { env, stdio: 'inherit' });
  
  console.log('Running playwright...');
  execSync('npx playwright test', { env, stdio: 'inherit' });
} catch (error) {
  console.error('E2E tests failed');
  process.exit(1);
}

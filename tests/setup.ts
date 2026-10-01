import { beforeAll } from 'vitest';

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL || '';

  if (dbUrl.includes('dev.db')) {
    throw new Error('FAIL-CLOSED: Refusing to run database-backed tests against prisma/dev.db. Aborting.');
  }

  if (dbUrl.includes('e2e.db')) {
    throw new Error('FAIL-CLOSED: Refusing to run database-backed tests against prisma/e2e.db. Aborting.');
  }

  if (!dbUrl.includes('test.db')) {
    throw new Error('FAIL-CLOSED: DATABASE_URL must be explicitly set to test.db for automated tests. Current: ' + dbUrl);
  }
});

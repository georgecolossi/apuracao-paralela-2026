import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting migration...');

  // 1. Run migration.sql
  const migrationPath = path.join(__dirname, '../../prisma/migrations/20261006_round_context/migration.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  const cleanSql = sql.replace(/--.*$/gm, '');
  const statements = cleanSql.split(';').map(s => s.trim()).filter(s => s.length > 0);

  for (const statement of statements) {
    try {
        await prisma.$executeRawUnsafe(statement);
      } catch (e: any) {
        // IDEMPOTENCY: SQLite does not fully support transactional DDL.
        // By swallowing 'already exists' and 'duplicate column name' errors,
        // we ensure that if the script crashes halfway through the statements,
        // running it again will safely skip the parts that succeeded previously
        // and only execute the remaining parts, fixing the state.
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column name')) {
          console.error(`Error executing statement: ${statement}`, e);
          throw e;
        } else {
          console.log(`Skipped existing schema element for: ${statement.split('\n')[0]}`);
        }
      }
  }

  console.log('Migration DDL applied (or already existed).');

  // 2. Run backfill
  const t1Round = await prisma.electionRound.findFirst({
    where: { roundNumber: 1 }
  });

  if (!t1Round) {
    console.error('T1 round not found!');
    return;
  }

  // Update PLEI for T1
  await prisma.electionRound.update({
    where: { id: t1Round.id },
    data: { plei: '3220' }
  });
  console.log('Updated T1 PLEI to 3220.');

  // Create coverage for T1 based on existing PollingSection
  const sections = await prisma.pollingSection.findMany();
  
  let createdCoverageCount = 0;
  for (const section of sections) {
    // Upsert to handle re-runs smoothly
    await prisma.roundCoverage.upsert({
      where: {
        electionRoundId_pollingSectionId: {
          electionRoundId: t1Round.id,
          pollingSectionId: section.id
        }
      },
      update: {
        expectedBUs: section.expectedBUs ?? 1
      },
      create: {
        electionRoundId: t1Round.id,
        pollingSectionId: section.id,
        expectedBUs: section.expectedBUs ?? 1
      }
    });
    createdCoverageCount++;
  }

  console.log(`Created/Updated ${createdCoverageCount} RoundCoverage records for T1.`);

  console.log('Migration and backfill completed successfully.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ';' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function processFile(filePath: string, allowedRoles: Set<string>) {
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    return;
  }

  console.log(`\nProcessando ${filePath}...`);
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let header: string[] = [];
  let count = 0;

  for await (const line of rl) {
    if (line.trim() === '') continue;

    const cols = parseCsvLine(line);
    
    if (header.length === 0) {
      header = cols.map(c => c.trim().toUpperCase());
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cols[i]?.trim() || '';
    }

    const officeCode = row['CD_CARGO'];
    if (!allowedRoles.has(officeCode)) {
      continue;
    }

    const candidateSequence = row['SQ_CANDIDATO'];
    if (!candidateSequence) continue;

    await prisma.candidateMetadata.upsert({
      where: { candidateSequence },
      update: {
        electionYear: parseInt(row['ANO_ELEICAO'], 10) || 2026,
        electionCode: row['CD_ELEICAO'] || '',
        round: parseInt(row['NR_TURNO'], 10) || 1,
        state: row['SG_UF'] || '',
        officeCode,
        officeName: row['DS_CARGO'] || '',
        candidateNumber: row['NR_CANDIDATO'] || '',
        ballotName: row['NM_URNA_CANDIDATO'] || '',
        partyNumber: row['NR_PARTIDO'] || '',
        partyAbbreviation: row['SG_PARTIDO'] || '',
        partyName: row['NM_PARTIDO'] || '',
        source: path.basename(filePath)
      },
      create: {
        candidateSequence,
        electionYear: parseInt(row['ANO_ELEICAO'], 10) || 2026,
        electionCode: row['CD_ELEICAO'] || '',
        round: parseInt(row['NR_TURNO'], 10) || 1,
        state: row['SG_UF'] || '',
        officeCode,
        officeName: row['DS_CARGO'] || '',
        candidateNumber: row['NR_CANDIDATO'] || '',
        ballotName: row['NM_URNA_CANDIDATO'] || '',
        partyNumber: row['NR_PARTIDO'] || '',
        partyAbbreviation: row['SG_PARTIDO'] || '',
        partyName: row['NM_PARTIDO'] || '',
        source: path.basename(filePath)
      }
    });

    count++;
    if (count % 100 === 0) {
      process.stdout.write(`\rImportados: ${count}`);
    }
  }
  console.log(`\rImportados: ${count} registros de ${path.basename(filePath)}.`);
}

async function main() {
  const brPath = path.join(__dirname, '../consulta_cand_2026/consulta_cand_2026_BR.csv');
  const scPath = path.join(__dirname, '../consulta_cand_2026/consulta_cand_2026_SC.csv');

  // BR: Somente Presidente (1)
  await processFile(brPath, new Set(['1']));

  // SC: Governador (3), Senador (5), Deputado Federal (6), Deputado Estadual (7)
  await processFile(scPath, new Set(['3', '5', '6', '7']));

  console.log('\nImportação concluída com sucesso!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

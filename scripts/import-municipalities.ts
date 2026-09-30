import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { prisma } from '../src/lib/db';

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let currentVal = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ';' && !inQuotes) {
      result.push(currentVal);
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  result.push(currentVal);
  return result;
}

// Map from ISO-8859-1 (often Windows-1252 context) to UTF-8 properly or just replace bad chars
function decodeString(str: string): string {
  // O arquivo fornecido possivelmente possui problemas de encoding nas fontes ("Conc?rdia").
  // Vamos preservar como estǭ e substituir as mǭscaras conhecidas, ou usar latin1 original.
  return str.replace(/Conc\?rdia/ig, 'Concórdia').replace(/S\?o /ig, 'São '); // simplificação pragmática
}

async function main() {
  const filePath = path.join(__dirname, '../municipio_tse_ibge/municipio_tse_ibge.csv');
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo de municípios ausente: ${filePath}`);
    process.exit(1);
  }

  // Primeiro garante que o estado SC existe
  let stateSC = await prisma.state.findUnique({ where: { abbreviation: 'SC' } });
  if (!stateSC) {
    stateSC = await prisma.state.create({ data: { name: 'Santa Catarina', abbreviation: 'SC' } });
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'latin1' }),
    crlfDelay: Infinity
  });

  let header: string[] = [];
  const municipalitiesSC = [];

  for await (const line of rl) {
    if (line.trim() === '') continue;
    
    const cols = parseCsvLine(line);
    if (header.length === 0) {
      header = cols.map(c => c.trim().toUpperCase());
      const required = ['SG_UF', 'CD_MUNICIPIO_TSE', 'NM_MUNICIPIO_TSE'];
      for (const req of required) {
        if (!header.includes(req)) {
          console.error(`Coluna ${req} não encontrada no dataset.`);
          process.exit(1);
        }
      }
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cols[i]?.trim() || '';
    }

    if (row['SG_UF'] === 'SC') {
      let nmMunicipio = row['NM_MUNICIPIO_TSE'];
      if (nmMunicipio.includes('?')) {
        nmMunicipio = nmMunicipio.replace(/Conc\?rdia/ig, 'Concórdia');
        nmMunicipio = nmMunicipio.replace(/Florian\?polis/ig, 'Florianópolis');
        nmMunicipio = nmMunicipio.replace(/Chapec\?/ig, 'Chapecó');
        nmMunicipio = nmMunicipio.replace(/S\?o /ig, 'São ');
        nmMunicipio = nmMunicipio.replace(/Joa\?aba/ig, 'Joaçaba');
      }

      municipalitiesSC.push({
        stateId: stateSC.id,
        officialCode: row['CD_MUNICIPIO_TSE'].padStart(5, '0'), // assegurar padrão de 5 digitos do tse
        name: nmMunicipio.toUpperCase(),
      });
    }
  }

  console.log(`Encontrados ${municipalitiesSC.length} municípios para SC.`);

  for (const m of municipalitiesSC) {
    await prisma.municipality.upsert({
      where: { officialCode: m.officialCode },
      update: { name: m.name },
      create: { stateId: m.stateId, officialCode: m.officialCode, name: m.name }
    });
  }

  // Verifica cobertura existente
  const existingCoverage = await prisma.municipality.count({
    where: { isCoverage: true }
  });

  if (existingCoverage === 0) {
    console.log('Nenhuma cobertura definida. Setando Concórdia/SC como padrão...');
    const concordia = await prisma.municipality.findUnique({ where: { officialCode: '80837' } });
    if (concordia) {
      await prisma.municipality.update({
        where: { id: concordia.id },
        data: { isCoverage: true }
      });
      console.log('Concórdia configurada como cobertura padrão.');
    } else {
      console.error('Concórdia (80837) não encontrada no banco após importação.');
      process.exit(1);
    }
  } else {
    console.log('Aviso: Cobertura administrativa já configurada. Nenhuma alteração foi feita.');
  }

  console.log('Importação de municípios concluída.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});

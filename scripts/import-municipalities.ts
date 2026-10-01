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
      const nmMunicipio = row['NM_MUNICIPIO_TSE'];

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

    // Fase 7.6: O catálogo oficial de municípios é importado sem forçar a cobertura.
  // Concórdia/SC (80837) estará presente, mas isCoverage permanecerá falso até
  // que o ADMIN configure explicitamente através do mecanismo de configuração.
  const concordiaMatches = await prisma.municipality.findMany({ 
    where: { 
      officialCode: '80837',
      state: { abbreviation: 'SC' }
    } 
  });

  if (concordiaMatches.length === 1) {
    console.log('Concórdia/SC (80837) importada com sucesso. (Cobertura geográfica precisa ser configurada pelo ADMIN).');
  } else {
    console.warn('Atenção: Concórdia/SC (80837) não foi inequivocamente identificada no dataset!');
  }

  console.log('Importação de municípios concluída.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});

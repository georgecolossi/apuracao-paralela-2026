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

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'latin1' }),
    crlfDelay: Infinity
  });

  let header: string[] = [];
  const municipalities = [];
  const stateMap = new Map<string, string>(); // SG_UF -> name (NM_UF se existisse, mas podemos extrair)
  
  for await (const line of rl) {
    if (line.trim() === '') continue;
    
    const cols = parseCsvLine(line);
    if (header.length === 0) {
      header = cols.map(c => c.trim().toUpperCase());
      const required = ['SG_UF', 'CD_MUNICIPIO_TSE', 'NM_MUNICIPIO_TSE', 'NM_UF'];
      for (const req of required) {
        if (!header.includes(req)) {
          console.error(`Coluna ${req} não encontrada no dataset.`);
          // Note: sometimes it might not have NM_UF explicitly, let's just do SG_UF, CD, NM
        }
      }
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cols[i]?.trim() || '';
    }

    const uf = row['SG_UF'];
    const nmUf = row['NM_UF'] || uf; // fallback to SG_UF if NM_UF doesn't exist
    const nmMunicipio = row['NM_MUNICIPIO_TSE'];

    if (!stateMap.has(uf)) {
        stateMap.set(uf, nmUf);
    }

    municipalities.push({
      uf,
      officialCode: row['CD_MUNICIPIO_TSE'].padStart(5, '0'),
      name: nmMunicipio.toUpperCase(),
    });
  }

  console.log(`Encontrados ${municipalities.length} municípios em todo o Brasil.`);
  
  // Garantir states primeiro
  const statesCache = new Map<string, string>();
  for (const [abbr, name] of stateMap.entries()) {
    const s = await prisma.state.upsert({
        where: { abbreviation: abbr },
        update: {},
        create: { abbreviation: abbr, name: name }
    });
    statesCache.set(abbr, s.id);
  }

  // batch upsert for performance or loop
  let count = 0;
  for (const m of municipalities) {
    await prisma.municipality.upsert({
      where: { officialCode: m.officialCode },
      update: { name: m.name, stateId: statesCache.get(m.uf)! },
      create: { stateId: statesCache.get(m.uf)!, officialCode: m.officialCode, name: m.name }
    });
    count++;
    if (count % 1000 === 0) console.log(`Importados ${count}...`);
  }

  // Verifica Concórdia
  const concordiaMatches = await prisma.municipality.findMany({ 
    where: { officialCode: '80837', state: { abbreviation: 'SC' } } 
  });

  if (concordiaMatches.length === 1) {
    console.log('Concórdia/SC (80837) importada com sucesso. (Cobertura geográfica precisa ser configurada pelo ADMIN).');
  } else {
    console.warn('Atenção: Concórdia/SC (80837) não foi inequivocamente identificada no dataset!');
  }
  
  // Verifica Rio Branco
  const rioBrancoMatches = await prisma.municipality.findMany({ 
    where: { officialCode: '01392', state: { abbreviation: 'AC' } } 
  });
  if (rioBrancoMatches.length === 1) {
    console.log('Rio Branco/AC (01392) importada com sucesso.');
  }

  console.log('Importação de municípios concluída.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});

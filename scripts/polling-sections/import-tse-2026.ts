import * as fs from 'fs';
import * as readline from 'readline';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const args = process.argv.slice(2);
  const filePath = args.find(a => !a.startsWith('--'));
  const isApply = args.includes('--apply');
  
  if (!filePath) {
    console.error('Uso: npx ts-node import-tse-2026.ts <caminho-csv> [--apply]');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error('Arquivo nao encontrado: ' + filePath);
    process.exit(1);
  }

  if (isApply) {
    if (process.env.ALLOW_PRODUCTION_POLLING_SECTION_IMPORT !== 'I_UNDERSTAND_THIS_WRITES_PRODUCTION') {
      console.error('ERRO: Para aplicar,  necessario definir ALLOW_PRODUCTION_POLLING_SECTION_IMPORT');
      process.exit(1);
    }
  }

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const municipalityTarget = '80837';
  const zonesMap = new Map<string, { zoneNumber: string, sections: Map<string, any> }>();

  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    
    const rawFields = line.split(';');
    const fields = rawFields.map(f => f.replace(/^"|"$/g, ''));
    
    const sgUf = fields[6];
    const cdMunicipio = fields[7];
    
    if (cdMunicipio === municipalityTarget) {
      if (sgUf !== 'SC') {
        console.error('ERRO: Inconsistencia. Municipio 80837 deveria ser SC.');
        process.exit(1);
      }
      
      const nrZona = fields[9];
      const nrSecao = fields[10];
      const dsAgregada = fields[12];
      const nrPrincipal = fields[13];
      
      const zStr = nrZona.padStart(4, '0');
      const sStr = nrSecao.padStart(4, '0');
      
      if (!zonesMap.has(zStr)) {
        zonesMap.set(zStr, { zoneNumber: zStr, sections: new Map() });
      }
      
      const zoneData = zonesMap.get(zStr)!;
      if (!zoneData.sections.has(sStr)) {
        zoneData.sections.set(sStr, {
          sectionNumber: sStr,
          isAggregated: dsAgregada === 'Agregada',
          principalSection: nrPrincipal
        });
      }
    }
  }

  if (zonesMap.size === 0) {
    console.error('ERRO: Nenhuma secao encontrada para o municipio ' + municipalityTarget);
    process.exit(1);
  }

  let totalSections = 0;
  let aggregatedSections = 0;
  let expectedBUsSum = 0;
  
  const printAggregated = [];

  for (const [zKey, zoneData] of zonesMap.entries()) {
    for (const [sKey, secData] of zoneData.sections.entries()) {
      totalSections++;
      if (secData.isAggregated) {
        aggregatedSections++;
        printAggregated.push(zKey + '/' + sKey + ' -> principal ' + secData.principalSection.padStart(4, '0'));
      } else {
        expectedBUsSum++;
      }
    }
  }

  console.log('Municipality: 80837 CONCORDIA');
  console.log('Zones: ' + zonesMap.size);
  console.log('Sections: ' + totalSections);
  console.log('Aggregated: ' + aggregatedSections);
  console.log('Expected BUs: ' + expectedBUsSum);
  if (printAggregated.length > 0) {
    console.log('Aggregated details:');
    printAggregated.forEach(a => console.log('  ' + a));
  }

  if (!isApply) {
    console.log('DRY-RUN mode. Nenhuma alteracao foi feita no banco de dados.');
    process.exit(0);
  }

  console.log('Iniciando persistencia no banco de dados...');
  const municipality = await prisma.municipality.findFirst({
    where: { officialCode: municipalityTarget }
  });

  if (!municipality) {
    console.error('Municipio nao encontrado no banco de dados.');
    process.exit(1);
  }

  for (const [zKey, zoneData] of zonesMap.entries()) {
    let pz = await prisma.pollingZone.findFirst({
      where: {
        municipalityId: municipality.id,
        zoneNumber: zKey
      }
    });
    
    if (!pz) {
      pz = await prisma.pollingZone.create({
        data: {
          municipalityId: municipality.id,
          zoneNumber: zKey
        }
      });
    }

    for (const [sKey, secData] of zoneData.sections.entries()) {
      const expectedBUs = secData.isAggregated ? 0 : 1;
      
      const ps = await prisma.pollingSection.findFirst({
        where: {
          pollingZoneId: pz.id,
          sectionNumber: sKey
        }
      });
      
      if (!ps) {
        await prisma.pollingSection.create({
          data: {
            pollingZoneId: pz.id,
            sectionNumber: sKey,
            expectedBUs: expectedBUs
          }
        });
      } else {
        await prisma.pollingSection.update({
          where: { id: ps.id },
          data: { expectedBUs: expectedBUs }
        });
      }
    }
  }

  console.log('Aplicacao concluida com sucesso.');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});

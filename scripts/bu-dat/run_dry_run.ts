import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/lib/db/index';
import { buildBallotReportIdentity } from '../../src/lib/identity';

export function resolveTurno(idPleito: number): string {
  if (idPleito === 3220) return '1';
  throw new Error('Turno nao mapeado para o pleito ' + idPleito);
}

export function resolveUf(municipio: number): string {
  if (municipio === 80837) return 'SC';
  throw new Error('UF nao mapeada para o municipio ' + municipio);
}

const officeMap: any = {
  '1': 'Presidente',
  '3': 'Governador',
  '5': 'Senador',
  '6': 'Deputado Federal',
  '7': 'Deputado Estadual',
  '11': 'Prefeito',
  '13': 'Vereador'
};

export function getOfficeName(cargo: string): string {
  return officeMap[cargo] || ('Cargo nao identificado (codigo ' + cargo + ')');
}

export function extractVotesFromDat(bu: any): any[] {
    const extractedVotes: any[] = [];
    const eleicoes = bu.resultadosVotacaoPorEleicao || [];
    for (const el of eleicoes) {
      const resultados = el.resultadosVotacao || [];
      for (const res of resultados) {
        const totais = res.totaisVotosCargo || [];
        for (const tot of totais) {
          const cargo = Array.isArray(tot.codigoCargo) ? tot.codigoCargo[1] : tot.codigoCargo;
          const officeName = getOfficeName(String(cargo));
          const votos = tot.votosVotaveis || [];
          for (const vv of votos) {
            if (vv.quantidadeVotos === 0) continue;

            let tVoto = vv.tipoVoto;
            if (Array.isArray(tVoto)) tVoto = tVoto[1];
            if (typeof tVoto === 'string') {
              if (tVoto === 'nominal') tVoto = 1;
              else if (tVoto === 'branco') tVoto = 2;
              else if (tVoto === 'nulo') tVoto = 3;
              else if (tVoto === 'legenda') tVoto = 4;
              else if (tVoto === 'cargoSemCandidato') tVoto = 5;
            }

            let voteType = 'NOMINAL';
            if (tVoto === 2) voteType = 'BRANCO';
            else if (tVoto === 3) voteType = 'NULO';
            else if (tVoto === 4) voteType = 'LEGENDA';
            else if (tVoto === 5) continue; 

            let candidateNum = vv.identificacaoVotavel?.codigo;
            let partyNum = vv.identificacaoVotavel?.partido;
            
            if (voteType === 'BRANCO' || voteType === 'NULO') {
                candidateNum = undefined;
                partyNum = undefined;
            } else if (voteType === 'LEGENDA') {
                partyNum = vv.identificacaoVotavel?.partido || vv.identificacaoVotavel?.codigo;
                candidateNum = undefined;
            } else if (voteType === 'NOMINAL') {
                if (['1', '3', '5', '11'].includes(String(cargo))) {
                    partyNum = undefined;
                }
            }

            extractedVotes.push({
              officeName,
              voteType,
              candidateNumber: candidateNum ? String(candidateNum) : null,
              partyNumber: partyNum ? String(partyNum) : null,
              quantity: vv.quantidadeVotos,
              cargoId: cargo
            });
          }
        }
      }
    }
    return extractedVotes;
}

export function compareVotes(extractedVotes: any[], dbVotes: any[]) {
    let hasConflict = false;
    const conflicts: string[] = [];
    
    const extMap = new Map();
    for (const v of extractedVotes) {
      const key = v.officeName + '-' + v.voteType + '-' + (v.candidateNumber || '') + '-' + (v.partyNumber || '');
      extMap.set(key, (extMap.get(key) || 0) + v.quantity);
    }
    
    const dbMap = new Map();
    for (const v of dbVotes) {
      if (v.quantity === 0) continue; 
      const key = v.office.name + '-' + v.voteType + '-' + (v.candidateNumber || '') + '-' + (v.partyNumber || '');
      dbMap.set(key, (dbMap.get(key) || 0) + v.quantity);
    }

    for (const [k, v] of extMap.entries()) {
      if (!dbMap.has(k)) {
        hasConflict = true;
        conflicts.push('Missing in DB: ' + k + ' (DAT=' + v + ')');
      } else if (dbMap.get(k) !== v) {
        hasConflict = true;
        conflicts.push('Quantity mismatch for ' + k + ': DB=' + dbMap.get(k) + ', DAT=' + v);
      }
    }

    for (const [k, v] of dbMap.entries()) {
      if (!extMap.has(k)) {
        hasConflict = true;
        conflicts.push('Extra in DB: ' + k + ' (DB=' + v + ')');
      }
    }
    
    return { hasConflict, conflicts };
}

async function main() {
  const dumpPath = path.resolve(process.cwd(), 'bu-decoded-dump.json');
  if (!fs.existsSync(dumpPath)) {
    console.error('bu-decoded-dump.json not found!');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

  const report = {
    totalFiles: data.length,
    decoded: 0,
    valid: 0,
    invalid: 0,
    alreadyExists: 0,
    new: 0,
    conflict: 0,
    pleitos: new Set<number>(),
    turnos: new Set<string>(),
    fases: new Set<number>(),
    municipios: new Set<number>(),
    ufs: new Set<string>(),
    zonas: new Set<string>(),
    secaos: new Set<string>(),
    cargos: new Set<number>(),
    deterministicIds: new Set<string>(),
    duplicatesInDataset: 0,
    duplicateZonasSecaos: 0,
    zonaSecaoSet: new Set<string>(),
    errors: [] as string[],
    results: [] as any[],
  };

  const dbReports = await prisma.ballotReport.findMany({
    include: { votes: { include: { office: true } }, round: true }
  });

  const reportMap = new Map(dbReports.map((r: any) => [r.deterministicId, r]));

  for (const item of data) {
    if (item.error) {
      report.invalid++;
      report.errors.push('File ' + item.file + ': ' + item.error);
      report.results.push({ file: item.file, status: 'INVALID', reason: 'DECODE_ERROR' });
      continue;
    }

    report.decoded++;

    const bu = item.decoded;
    const cabecalho = bu.cabecalho || {};
    const idEleitoral = cabecalho.idEleitoral || [];
    const idPleito = idEleitoral[1];
    const fase = bu.fase;
    
    let idSecao = cabecalho.identificacaoSecaoEleitoral || cabecalho.identificacaoUrna || bu.identificacaoSecao;
    if (cabecalho.identificacaoUrna && Array.isArray(cabecalho.identificacaoUrna)) {
        idSecao = cabecalho.identificacaoUrna[1];
    }
    
    const municipio = idSecao?.municipioZona?.municipio;
    const zona = idSecao?.municipioZona?.zona;
    const secao = idSecao?.secao;

    const urna = bu.urna || {};
    const carga = urna.correspondenciaResultado?.carga || {};
    const numeroInternoUrna = carga.numeroInternoUrna;

    report.pleitos.add(idPleito);
    report.fases.add(fase);
    report.municipios.add(municipio);

    let turnoStr = '';
    let ufStr = '';
    try {
      turnoStr = resolveTurno(idPleito);
      report.turnos.add(turnoStr);
      ufStr = resolveUf(municipio);
      report.ufs.add(ufStr);
    } catch (e: any) {
      report.invalid++;
      report.errors.push('File ' + item.file + ': ' + e.message);
      report.results.push({ file: item.file, status: 'INVALID', reason: 'UNMAPPED_VALUE' });
      continue;
    }

    if (turnoStr !== '1' || fase !== 2 || ufStr !== 'SC' || municipio !== 80837) {
      report.invalid++;
      report.errors.push('File ' + item.file + ': Escopo invalido');
      report.results.push({ file: item.file, status: 'INVALID', reason: 'INVALID_SCOPE' });
      continue;
    }

    const zCodeCanonical = String(zona);
    const sCodeCanonical = String(secao);

    const m = item.file.match(/^o(\d{5})([a-z]{2})(\d{5})(\d{4})(\d{4})-bu\.dat$/);
    if (m) {
      const [ , fPleito, fUf, fMuni, fZona, fSecao ] = m;
      if (
        String(idPleito).padStart(5, '0') !== fPleito ||
        ufStr.toLowerCase() !== fUf ||
        String(municipio).padStart(5, '0') !== fMuni ||
        String(zona).padStart(4, '0') !== fZona ||
        String(secao).padStart(4, '0') !== fSecao
      ) {
        report.invalid++;
        report.errors.push('File ' + item.file + ': ASN.1 content does not match filename');
        report.results.push({ file: item.file, status: 'INVALID', reason: 'MISMATCH_FILENAME' });
        continue;
      }
    } else {
      report.errors.push('File ' + item.file + ': filename format not recognized but BU parsed successfully');
    }

    report.valid++;
    
    report.zonas.add(zCodeCanonical);
    report.secaos.add(sCodeCanonical);
    
    const zsKey = zCodeCanonical + '-' + sCodeCanonical;
    if (report.zonaSecaoSet.has(zsKey)) {
        report.duplicateZonasSecaos++;
    } else {
        report.zonaSecaoSet.add(zsKey);
    }

    const deterministicId = buildBallotReportIdentity({
      plei: String(idPleito),
      turn: turnoStr,
      stateCode: ufStr,
      cityCode: String(municipio),
      zoneCode: zCodeCanonical,
      sectionCode: sCodeCanonical,
      urnCode: String(numeroInternoUrna)
    });

    if (report.deterministicIds.has(deterministicId)) {
        report.duplicatesInDataset++;
    } else {
        report.deterministicIds.add(deterministicId);
    }

    const extractedVotes = extractVotesFromDat(bu);
    for (const v of extractedVotes) {
        report.cargos.add(v.cargoId);
    }

    const resultBase = {
      file: item.file,
      deterministicId,
      zoneCode: zCodeCanonical,
      sectionCode: sCodeCanonical,
      urnCode: String(numeroInternoUrna)
    };

    const existing = reportMap.get(deterministicId);
    if (!existing) {
      report.new++;
      report.results.push({ ...resultBase, status: 'NEW' });
    } else {
      const { hasConflict, conflicts } = compareVotes(extractedVotes, existing.votes);

      if (hasConflict) {
        report.conflict++;
        report.results.push({ ...resultBase, status: 'CONFLICT', reason: 'VOTE_MISMATCH', details: conflicts });
      } else {
        report.alreadyExists++;
        report.results.push({ ...resultBase, status: 'ALREADY_EXISTS' });
      }
    }
  }

  const finalReport = {
    ...report,
    pleitos: Array.from(report.pleitos),
    turnos: Array.from(report.turnos),
    fases: Array.from(report.fases),
    municipios: Array.from(report.municipios),
    ufs: Array.from(report.ufs),
    zonas: Array.from(report.zonas).sort(),
    secaos: Array.from(report.secaos).sort(),
    cargos: Array.from(report.cargos).sort((a:any, b:any) => a - b),
    zonaSecaoSet: undefined,
    deterministicIds: undefined,
  };

  console.log('========================================');
  console.log('BU DAT - DRY RUN');
  console.log('========================================\\n');
  console.log('Banco de dados (LOCAL_DB_COMPARISON):');
  console.log(process.env.DATABASE_URL || 'file:./prod.db (padrao Prisma)\\n');
  
  console.log('Arquivos encontrados: ' + report.totalFiles);
  console.log('Decodificados: ' + report.decoded);
  console.log('Validos: ' + report.valid);
  console.log('Invalidos: ' + report.invalid + '\\n');
  
  console.log('Pleitos distintos: ' + finalReport.pleitos.join(', '));
  console.log('Turnos distintos: ' + finalReport.turnos.join(', '));
  console.log('Fases distintas: ' + finalReport.fases.join(', '));
  console.log('Municipios distintos: ' + finalReport.municipios.join(', '));
  console.log('UFs distintas: ' + finalReport.ufs.join(', '));
  console.log('Zonas distintas: ' + finalReport.zonas.join(', '));
  console.log('Secoes distintas: ' + finalReport.secaos.length + ' (total na lista)');
  console.log('Cargos encontrados: ' + finalReport.cargos.join(', ') + '\\n');
  
  console.log('DeterministicIds distintos no dataset: ' + report.deterministicIds.size);
  console.log('Duplicatas de DeterministicId dentro do dataset: ' + report.duplicatesInDataset);
  console.log('Duplicatas de Zona+Secao dentro do dataset: ' + report.duplicateZonasSecaos + '\\n');

  console.log('Ja existentes: ' + report.alreadyExists);
  console.log('Novos: ' + report.new);
  console.log('Conflitos: ' + report.conflict + '\\n');

  fs.writeFileSync('bu-import-dry-run.json', JSON.stringify(finalReport, null, 2), 'utf8');
}

if (require.main === module) {
  if (process.argv.includes('--apply')) {
    console.log('APPLY_NOT_IMPLEMENTED');
    process.exit(1);
  }

  main().catch(console.error);
}

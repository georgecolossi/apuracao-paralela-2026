import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/lib/db/index';
import { buildBallotReportIdentity } from '../../src/lib/identity';

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
    zonas: new Set<string>(),
    secaos: new Set<string>(),
    cargos: new Set<number>(),
    errors: [] as string[],
    results: [] as any[],
  };

  const dbReports = await prisma.ballotReport.findMany({
    include: { votes: true, round: true }
  });

  const reportMap = new Map(dbReports.map(r => [r.deterministicId, r]));

  for (const item of data) {
    if (item.error) {
      report.invalid++;
      report.errors.push(`File ${item.file}: ${item.error}`);
      report.results.push({ file: item.file, status: 'INVALID', reason: 'DECODE_ERROR' });
      continue;
    }

    report.decoded++;

    const bu = item.decoded;
    const cabecalho = bu.cabecalho || {};
    const idEleitoral = cabecalho.idEleitoral || [];
    const idPleito = idEleitoral[1];
    const fase = bu.fase;
    
    // Identificacao
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

    // Validate filename cross-check
    const m = item.file.match(/^o(\d{5})([a-z]{2})(\d{5})(\d{4})(\d{4})-bu\.dat$/);
    if (!m) {
      report.invalid++;
      report.errors.push(`File ${item.file}: filename format not recognized`);
      report.results.push({ file: item.file, status: 'INVALID', reason: 'FILENAME_FORMAT' });
      continue;
    }

    const [ , fPleito, fUf, fMuni, fZona, fSecao ] = m;

    if (
      String(idPleito).padStart(5, '0') !== fPleito ||
      String(municipio).padStart(5, '0') !== fMuni ||
      String(zona).padStart(4, '0') !== fZona ||
      String(secao).padStart(4, '0') !== fSecao
    ) {
      report.invalid++;
      report.errors.push(`File ${item.file}: ASN.1 content does not match filename`);
      report.results.push({ file: item.file, status: 'INVALID', reason: 'MISMATCH_FILENAME' });
      continue;
    }

    if (
      idPleito !== 3220 ||
      fUf !== 'sc' ||
      municipio !== 80837 ||
      fase !== 2 // 2 = OFICIAL
    ) {
      report.invalid++;
      report.errors.push(`File ${item.file}: Escopo invalido (pleito=${idPleito}, uf=${fUf}, mun=${municipio}, fase=${fase})`);
      report.results.push({ file: item.file, status: 'INVALID', reason: 'INVALID_SCOPE' });
      continue;
    }
    
    const turno = '1';

    report.valid++;
    report.zonas.add(String(zona).padStart(4, '0'));
    report.secaos.add(String(secao).padStart(4, '0'));

    const deterministicId = buildBallotReportIdentity({
      plei: String(idPleito),
      turn: turno,
      stateCode: fUf.toUpperCase(),
      cityCode: String(municipio),
      zoneCode: String(zona).padStart(4, '0'),
      sectionCode: String(secao).padStart(4, '0'),
      urnCode: String(numeroInternoUrna)
    });

    // Extract votes for comparison
    const extractedVotes: any[] = [];
    const eleicoes = bu.resultadosVotacaoPorEleicao || [];
    for (const el of eleicoes) {
      const resultados = el.resultadosVotacao || [];
      for (const res of resultados) {
        const totais = res.totaisVotosCargo || [];
        for (const tot of totais) {
          const cargo = Array.isArray(tot.codigoCargo) ? tot.codigoCargo[1] : tot.codigoCargo;
          report.cargos.add(cargo);
          
          const votos = tot.votosVotaveis || [];
          for (const vv of votos) {
            let tVoto = vv.tipoVoto;
            if (Array.isArray(tVoto)) tVoto = tVoto[1];
            if (typeof tVoto === 'string') {
              if (tVoto === 'nominal') tVoto = 1;
              else if (tVoto === 'branco') tVoto = 2;
              else if (tVoto === 'nulo') tVoto = 3;
              else if (tVoto === 'legenda') tVoto = 4;
            }

            let voteType = 'NOMINAL';
            if (tVoto === 2) voteType = 'BRANCO';
            if (tVoto === 3) voteType = 'NULO';
            if (tVoto === 4) voteType = 'LEGENDA';

            let candidateNum = vv.identificacaoVotavel?.codigo;
            let partyNum = vv.identificacaoVotavel?.partido;
            
            if (voteType === 'BRANCO' || voteType === 'NULO') {
                candidateNum = undefined;
                partyNum = undefined;
            } else if (voteType === 'LEGENDA') {
                partyNum = vv.identificacaoVotavel?.partido || vv.identificacaoVotavel?.codigo;
                candidateNum = undefined;
            }

            extractedVotes.push({
              officeId: String(cargo),
              voteType,
              candidateNumber: candidateNum ? String(candidateNum) : null,
              partyNumber: partyNum ? String(partyNum) : null,
              quantity: vv.quantidadeVotos
            });
          }
        }
      }
    }

    const existing = reportMap.get(deterministicId);
    if (!existing) {
      report.new++;
      report.results.push({ file: item.file, status: 'NEW', deterministicId });
    } else {
      // Check for conflict
      let hasConflict = false;
      const dbVotes = existing.votes;
      
      const extMap = new Map();
      for (const v of extractedVotes) {
        const key = `${v.officeId}-${v.voteType}-${v.candidateNumber || ''}-${v.partyNumber || ''}`;
        extMap.set(key, (extMap.get(key) || 0) + v.quantity);
      }
      
      const dbMap = new Map();
      for (const v of dbVotes) {
        const key = `${v.officeId}-${v.voteType}-${v.candidateNumber || ''}-${v.partyNumber || ''}`;
        dbMap.set(key, (dbMap.get(key) || 0) + v.quantity);
      }

      if (extMap.size !== dbMap.size) {
        hasConflict = true;
      } else {
        for (const [k, v] of extMap.entries()) {
          if (dbMap.get(k) !== v) {
            hasConflict = true;
            break;
          }
        }
      }

      if (hasConflict) {
        report.conflict++;
        report.results.push({ file: item.file, status: 'CONFLICT', deterministicId });
      } else {
        report.alreadyExists++;
        report.results.push({ file: item.file, status: 'ALREADY_EXISTS', deterministicId });
      }
    }
  }

  // Convert Sets to Arrays for JSON serialization
  const finalReport = {
    ...report,
    zonas: Array.from(report.zonas).sort(),
    secaos: Array.from(report.secaos).sort(),
    cargos: Array.from(report.cargos).sort((a,b) => a-b)
  };

  console.log('========================================');
  console.log('BU DAT — DRY RUN');
  console.log('========================================\n');
  console.log(`Arquivos encontrados: ${report.totalFiles}`);
  console.log(`Pleito:\n3220\n`);
  console.log(`UF:\nSC\n`);
  console.log(`Município:\n80837\n`);
  console.log(`Turno:\n1\n`);
  console.log(`Zonas encontradas:\n${finalReport.zonas.join('\n')}\n`);
  console.log(`Decodificados:\n${report.decoded}\n`);
  console.log(`Válidos:\n${report.valid}\n`);
  console.log(`Inválidos:\n${report.invalid}\n`);
  console.log(`Já existentes:\n${report.alreadyExists}\n`);
  console.log(`Novos:\n${report.new}\n`);
  console.log(`Conflitos:\n${report.conflict}\n`);

  fs.writeFileSync('bu-import-dry-run.json', JSON.stringify(finalReport, null, 2), 'utf8');
}

if (process.argv.includes('--apply')) {
  console.log('APPLY_NOT_IMPLEMENTED');
  process.exit(1);
}

main().catch(console.error);

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

export interface ImportT2Report {
  totalRowsRead: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  errors: string[];
}

export async function importCandidatesT2(
  filePath: string,
  options: {
    apply?: boolean;
    confirmLabImport?: boolean;
    allowedRoles?: Set<string>;
  } = {}
): Promise<ImportT2Report> {
  const { apply = false, confirmLabImport = false, allowedRoles = new Set(['1']) } = options;

  const report: ImportT2Report = {
    totalRowsRead: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    rejected: 0,
    errors: []
  };

  // 1. Verificação Estrita de Segurança de Banco de Dados
  const dbUrl = process.env.DATABASE_URL || '';
  const isAuthorizedLab = dbUrl.includes('lab_h10m3b1') || dbUrl.includes('lab.db');
  const isCloudOrProd = dbUrl.includes('prod.db') || dbUrl.includes('staging.db') || dbUrl.includes('railway');

  if (apply && (!isAuthorizedLab || isCloudOrProd || !confirmLabImport)) {
    const errMsg = 'EXECUÇÃO BLOQUEADA: importCandidatesT2 só pode aplicar escritas no banco isolado de laboratório mediante --confirm-lab-import.';
    report.errors.push(errMsg);
    throw new Error(errMsg);
  }

  if (!fs.existsSync(filePath)) {
    const errMsg = `Arquivo não encontrado: ${filePath}`;
    report.errors.push(errMsg);
    throw new Error(errMsg);
  }

  const fileStream = fs.createReadStream(filePath, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let header: string[] = [];
  const REQUIRED_HEADERS = [
    'ANO_ELEICAO', 'NR_TURNO', 'CD_ELEICAO', 'SG_UF',
    'CD_CARGO', 'DS_CARGO', 'SQ_CANDIDATO', 'NR_CANDIDATO',
    'NM_URNA_CANDIDATO', 'NR_PARTIDO', 'SG_PARTIDO', 'NM_PARTIDO'
  ];

  const pendingRecords: Array<{
    candidateSequence: string;
    rawSqCand: string;
    electionYear: number;
    electionCode: string;
    round: number;
    state: string;
    officeCode: string;
    officeName: string;
    candidateNumber: string;
    ballotName: string;
    partyNumber: string;
    partyAbbreviation: string;
    partyName: string;
    source: string;
  }> = [];

  for await (const line of rl) {
    report.totalRowsRead++;
    if (line.trim() === '') continue;

    const cols = parseCsvLine(line);

    if (header.length === 0) {
      header = cols.map(c => c.trim().toUpperCase());
      for (const req of REQUIRED_HEADERS) {
        if (!header.includes(req)) {
          const errMsg = `Coluna obrigatória ausente no cabeçalho: ${req}`;
          report.errors.push(errMsg);
          throw new Error(errMsg);
        }
      }
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cols[i]?.trim() || '';
    }

    const officeCode = row['CD_CARGO'];
    if (!allowedRoles.has(officeCode)) {
      report.skipped++;
      continue;
    }

    const electionYear = parseInt(row['ANO_ELEICAO'], 10);
    const round = parseInt(row['NR_TURNO'], 10);

    if (electionYear !== 2026) {
      report.rejected++;
      report.errors.push(`Linha rejeitada: ANO_ELEICAO ${electionYear} diferente de 2026.`);
      continue;
    }

    if (round !== 2) {
      report.rejected++;
      report.errors.push(`Linha rejeitada: NR_TURNO ${round} diferente de 2 (Segundo Turno).`);
      continue;
    }

    const rawSqCand = row['SQ_CANDIDATO'];
    if (!rawSqCand) {
      report.rejected++;
      report.errors.push('Linha rejeitada: SQ_CANDIDATO ausente.');
      continue;
    }

    // Sufixo Operacional Canônico -T2 garantindo isolamento estrito contra o 1º Turno
    const candidateSequence = `${rawSqCand}-T2`;
    const source = `${path.basename(filePath)} (SQ_OFICIAL:${rawSqCand})`;

    pendingRecords.push({
      candidateSequence,
      rawSqCand,
      electionYear,
      electionCode: row['CD_ELEICAO'] || '',
      round,
      state: row['SG_UF'] || '',
      officeCode,
      officeName: row['DS_CARGO'] || '',
      candidateNumber: row['NR_CANDIDATO'] || '',
      ballotName: row['NM_URNA_CANDIDATO'] || '',
      partyNumber: row['NR_PARTIDO'] || '',
      partyAbbreviation: row['SG_PARTIDO'] || '',
      partyName: row['NM_PARTIDO'] || '',
      source
    });

    report.processed++;
  }

  console.log(`[import-candidates-t2] Total de linhas lidas: ${report.totalRowsRead}`);
  console.log(`[import-candidates-t2] Linhas processáveis do T2: ${report.processed}`);
  console.log(`[import-candidates-t2] Linhas puladas (outros cargos): ${report.skipped}`);
  console.log(`[import-candidates-t2] Linhas rejeitadas (outros turnos/anos): ${report.rejected}`);

  if (!apply) {
    console.log('[import-candidates-t2] MODO DRY-RUN: Nenhuma gravação efetuada no banco de dados.');
    return report;
  }

  console.log('[import-candidates-t2] Aplicando importação em transação controlada no banco local...');

  await prisma.$transaction(async (tx) => {
    for (const rec of pendingRecords) {
      // 1. Garantir que o registro do 1º Turno permanece intocado
      const existingT1 = await tx.candidateMetadata.findUnique({
        where: { candidateSequence: rec.rawSqCand }
      });
      if (existingT1 && existingT1.round !== 1) {
        throw new Error(`Inconsistência prévia: registro ${rec.rawSqCand} possui round ${existingT1.round} em vez de 1.`);
      }

      // 2. Upsert isolado na chave -T2
      const existingT2 = await tx.candidateMetadata.findUnique({
        where: { candidateSequence: rec.candidateSequence }
      });

      if (existingT2) {
        await tx.candidateMetadata.update({
          where: { candidateSequence: rec.candidateSequence },
          data: {
            electionYear: rec.electionYear,
            electionCode: rec.electionCode,
            round: rec.round,
            state: rec.state,
            officeCode: rec.officeCode,
            officeName: rec.officeName,
            candidateNumber: rec.candidateNumber,
            ballotName: rec.ballotName,
            partyNumber: rec.partyNumber,
            partyAbbreviation: rec.partyAbbreviation,
            partyName: rec.partyName,
            source: rec.source
          }
        });
        report.updated++;
      } else {
        await tx.candidateMetadata.create({
          data: {
            candidateSequence: rec.candidateSequence,
            electionYear: rec.electionYear,
            electionCode: rec.electionCode,
            round: rec.round,
            state: rec.state,
            officeCode: rec.officeCode,
            officeName: rec.officeName,
            candidateNumber: rec.candidateNumber,
            ballotName: rec.ballotName,
            partyNumber: rec.partyNumber,
            partyAbbreviation: rec.partyAbbreviation,
            partyName: rec.partyName,
            source: rec.source
          }
        });
        report.inserted++;
      }
    }
  });

  console.log(`[import-candidates-t2] Sucesso! Inseridos: ${report.inserted}, Atualizados: ${report.updated}`);
  return report;
}

// Suporte para execução via linha de comando
if (require.main === module) {
  const args = process.argv.slice(2);
  const filePath = args.find(a => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const confirmLabImport = args.includes('--confirm-lab-import');

  if (!filePath) {
    console.error('Uso: npx tsx scripts/import-candidates-t2.ts <caminho-csv> [--apply --confirm-lab-import]');
    process.exit(1);
  }

  importCandidatesT2(filePath, { apply, confirmLabImport })
    .then((rep) => {
      console.log('Relatório Final:', rep);
      process.exit(0);
    })
    .catch((err) => {
      console.error('ERRO FATAL NA IMPORTAÇÃO T2:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

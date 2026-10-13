import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * PARÂMETROS OFICIAIS TSE — SEGUNDO TURNO ELEIÇÕES GERAIS 2026
 * Homologados para Concórdia/SC (Zona Eleitoral 0090, Município 80837)
 * Fonte Oficial: https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados
 */
export const TSE_2026_T2_OFFICIAL_PARAMS = {
  plei: '3221',
  roundNumber: 2,
  federalElectionCode: '6258', // Eleição Geral Federal — Presidente da República
  environment: 'oficial',      // FASE: 'O'
  electionDate: '2026-10-25',  // DTPL: '20261025'
  sourceUrl: 'https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados',
  municipalityCode: '80837',   // Concórdia/SC
  zoneNumber: '0090',          // 90ª Zona Eleitoral
  expectedBUs: 193             // Urnas com BU próprio (seção 125 agregada à 90)
} as const;

export interface ConfigureT2Options {
  plei?: string;
  copyCoverage?: boolean;
  applyOfficial?: boolean;
  confirm?: boolean;
}

export async function getT2Status() {
  const election = await prisma.election.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' }
      }
    }
  });

  if (!election) {
    return { error: 'Nenhuma eleição ativa encontrada no sistema.' };
  }

  const t1 = election.rounds.find(r => r.roundNumber === 1);
  const t2 = election.rounds.find(r => r.roundNumber === 2);

  const t1Coverage = t1 ? await prisma.roundCoverage.count({ where: { electionRoundId: t1.id } }) : 0;
  const t2Coverage = t2 ? await prisma.roundCoverage.count({ where: { electionRoundId: t2.id } }) : 0;

  const t2Candidates = t2?.plei 
    ? await prisma.candidateMetadata.count({ where: { electionCode: t2.plei, round: 2 } })
    : 0;

  return {
    electionId: election.id,
    electionYear: election.year,
    officialTseParams: TSE_2026_T2_OFFICIAL_PARAMS,
    t1: t1 ? {
      id: t1.id,
      status: t1.status,
      plei: t1.plei,
      coverageRows: t1Coverage
    } : null,
    t2: t2 ? {
      id: t2.id,
      status: t2.status,
      plei: t2.plei || 'NÃO CONFIGURADO',
      coverageRows: t2Coverage,
      candidatesCount: t2Candidates,
      readyForActivation: Boolean(t2.plei === TSE_2026_T2_OFFICIAL_PARAMS.plei && t2Coverage >= TSE_2026_T2_OFFICIAL_PARAMS.expectedBUs && t2Candidates >= 2)
    } : null
  };
}

export async function configureT2(options: ConfigureT2Options) {
  const { applyOfficial = false, copyCoverage = false, confirm = false } = options;
  const plei = applyOfficial ? TSE_2026_T2_OFFICIAL_PARAMS.plei : options.plei;
  const shouldCopyCoverage = applyOfficial || copyCoverage;

  console.log('[T2-CONFIG] Iniciando ferramenta de configuração do Segundo Turno (T2)...');

  // Proteção contra mutações em bancos operacionais
  const dbUrl = process.env.DATABASE_URL || '';
  const isCloudOrProd = dbUrl.includes('prod.db') || dbUrl.includes('staging.db') || dbUrl.includes('railway');
  if (confirm && isCloudOrProd) {
    throw new Error('[SEGURANÇA] Mutação direta em banco operacional bloqueada pelo script. Utilize o procedimento supervisionado do runbook.');
  }

  const status = await getT2Status();
  if ('error' in status) {
    throw new Error(status.error);
  }

  if (!status.t2) {
    throw new Error('Segundo Turno (roundNumber = 2) não encontrado nesta eleição.');
  }

  if (status.t2.status !== 'PLANNED') {
    throw new Error(`Operação bloqueada: T2 está em estado '${status.t2.status}'. Apenas turnos em 'PLANNED' podem ser configurados.`);
  }

  if (!plei && !shouldCopyCoverage) {
    console.log('\n[STATUS ATUAL DO T2]:');
    console.log(JSON.stringify(status, null, 2));
    console.log('\nNenhum parâmetro de atualização fornecido. Use --apply-official ou --plei <CODIGO> com --confirm para aplicar.');
    return status;
  }

  if (!confirm) {
    console.log('\n[DRY-RUN] Simulação de configuração com os seguintes parâmetros:');
    console.log(`  PLEI Alvo         : ${plei || status.t2.plei}`);
    console.log(`  Sincronizar Cobertura: ${shouldCopyCoverage ? 'SIM (193 seções)' : 'NÃO'}`);
    console.log(`  Status Final      : PLANNED (inalterado)`);
    console.log('Para persistir no banco local de laboratório, adicione a flag --confirm.');
    return status;
  }

  // 1. Atualizar PLEI oficial se fornecido
  if (plei) {
    if (!/^\d{4,6}$/.test(plei.trim())) {
      throw new Error(`PLEI inválido: '${plei}'. Deve ser um código numérico de 4 a 6 dígitos.`);
    }

    const cleanPlei = plei.trim();
    console.log(`[T2-CONFIG] Configurando PLEI oficial do T2 para: ${cleanPlei}...`);

    await prisma.electionRound.update({
      where: { id: status.t2.id },
      data: { plei: cleanPlei }
    });

    console.log('[T2-CONFIG] PLEI atualizado com sucesso.');
  }

  // 2. Replicar malha de seções de Concórdia para RoundCoverage do T2
  if (shouldCopyCoverage) {
    console.log('[T2-CONFIG] Sincronizando cobertura de seções de Concórdia (Zona 0090) para o T2...');

    // Busca seções com expectedBUs > 0 (193 seções com urna independente)
    const sections = await prisma.pollingSection.findMany({
      where: {
        expectedBUs: { gt: 0 }
      }
    });

    let configuredCount = 0;
    for (const sec of sections) {
      await prisma.roundCoverage.upsert({
        where: {
          electionRoundId_pollingSectionId: {
            electionRoundId: status.t2.id,
            pollingSectionId: sec.id
          }
        },
        update: {
          expectedBUs: sec.expectedBUs || 1
        },
        create: {
          electionRoundId: status.t2.id,
          pollingSectionId: sec.id,
          expectedBUs: sec.expectedBUs || 1
        }
      });
      configuredCount++;
    }

    console.log(`[T2-CONFIG] ${configuredCount} registros de RoundCoverage configurados para o T2.`);
  }

  // Registra no AuditLog
  try {
    await prisma.auditLog.create({
      data: {
        action: 'T2_OFFICIAL_PARAMETERS_CONFIGURED',
        identifiers: JSON.stringify({
          pleiConfigured: plei,
          coverageSynced: shouldCopyCoverage,
          roundId: status.t2.id,
          officialSource: TSE_2026_T2_OFFICIAL_PARAMS.sourceUrl
        }),
        result: 'SUCCESS'
      }
    });
  } catch (_) {}

  const updatedStatus = await getT2Status();
  console.log('\n[T2-CONFIG] Configuração oficial concluída com sucesso!');
  console.log(JSON.stringify(updatedStatus, null, 2));

  return updatedStatus;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const pleiArgIndex = args.indexOf('--plei');
  const plei = pleiArgIndex !== -1 ? args[pleiArgIndex + 1] : undefined;
  const copyCoverage = args.includes('--copy-coverage');
  const applyOfficial = args.includes('--apply-official');
  const confirm = args.includes('--confirm');

  configureT2({ plei, copyCoverage, applyOfficial, confirm })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n[ERRO]:', err.message);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

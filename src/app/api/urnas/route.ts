import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateTerritoryCode, getTerritoryVariants } from '@/lib/presentation/territoryValidator';
import { validateAndDecodeCursor, encodeUrnaCursor, CursorContext } from '@/lib/presentation/urnaCursor';
import { UrnaFeedItemDTO, UrnaFeedResponse } from '@/lib/presentation/pressDto';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_HEADER = 'public, max-age=5, s-maxage=5, stale-while-revalidate=10';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const electionParam = searchParams.get('election') || searchParams.get('electionId') || searchParams.get('slug');
    const roundParam = searchParams.get('round');
    const zoneRaw = searchParams.get('zone');
    const sectionRaw = searchParams.get('section');
    const cursorParam = searchParams.get('cursor');
    const limitRaw = searchParams.get('limit');

    // 1. Resolução de Eleição (Sem HTTP 500)
    let election;
    if (electionParam) {
      const found = await prisma.election.findFirst({
        where: {
          OR: [{ id: electionParam }, { slug: electionParam }]
        },
        include: {
          rounds: { orderBy: { roundNumber: 'asc' } }
        }
      });
      if (!found) {
        return NextResponse.json({
          error: 'ELEICAO_NAO_ENCONTRADA',
          message: `Eleição '${electionParam}' não encontrada no sistema.`
        }, { status: 404, headers: { 'Cache-Control': CACHE_HEADER } });
      }
      election = found;
    } else {
      const activeElections = await prisma.election.findMany({
        where: { status: 'ACTIVE' },
        include: {
          rounds: { orderBy: { roundNumber: 'asc' } }
        }
      });

      if (activeElections.length === 0) {
        const emptyResponse: UrnaFeedResponse = {
          context: null,
          pagination: { limit: 20, hasMore: false, nextCursor: null },
          filters: { zone: null, section: null },
          items: [],
          message: 'Nenhuma eleição ativa no momento.'
        };
        return NextResponse.json(emptyResponse, { headers: { 'Cache-Control': CACHE_HEADER } });
      }

      if (activeElections.length > 1) {
        return NextResponse.json({
          error: 'ELEICOES_MULTIPLAS_ATIVAS',
          message: 'Múltiplas eleições ativas configuradas. Especifique o parâmetro ?election=<id_ou_slug>.',
          activeElections: activeElections.map(e => ({ id: e.id, slug: e.slug, name: e.name }))
        }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
      }

      election = activeElections[0];
    }

    // 2. Resolução de Turno (Sem HTTP 500)
    let targetRound;
    if (roundParam !== null && roundParam !== undefined) {
      if (!/^[1-2]$/.test(roundParam)) {
        return NextResponse.json({
          error: 'TURNO_INVALIDO',
          message: "O parâmetro 'round' deve ser 1 ou 2."
        }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
      }
      const rNum = parseInt(roundParam, 10);
      targetRound = election.rounds.find(r => r.roundNumber === rNum);
      if (!targetRound) {
        return NextResponse.json({
          error: 'TURNO_NAO_ENCONTRADO',
          message: `O ${rNum}º Turno não foi encontrado para esta eleição.`
        }, { status: 404, headers: { 'Cache-Control': CACHE_HEADER } });
      }
    } else {
      const activeRounds = election.rounds.filter(r => r.status === 'ACTIVE');
      if (activeRounds.length === 0) {
        const emptyResponse: UrnaFeedResponse = {
          context: {
            election: { id: election.id, slug: election.slug, name: election.name, year: election.year },
            round: null
          },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
          filters: { zone: null, section: null },
          items: [],
          message: 'Nenhum turno ativo nesta eleição.'
        };
        return NextResponse.json(emptyResponse, { headers: { 'Cache-Control': CACHE_HEADER } });
      }

      if (activeRounds.length > 1) {
        return NextResponse.json({
          error: 'TURNOS_MULTIPLOS_ATIVOS',
          message: 'Múltiplos turnos ativos configurados nesta eleição. Especifique o parâmetro ?round=1 ou ?round=2.',
          activeRounds: activeRounds.map(r => ({ id: r.id, roundNumber: r.roundNumber, status: r.status }))
        }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
      }

      targetRound = activeRounds[0];
    }

    // 3. Validação dos Filtros Territoriais
    const zoneVal = validateTerritoryCode(zoneRaw, 'zone');
    if (!zoneVal.valid) {
      return NextResponse.json({
        error: 'PARAMETRO_INVALIDO',
        message: zoneVal.error
      }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
    }

    const sectionVal = validateTerritoryCode(sectionRaw, 'section');
    if (!sectionVal.valid) {
      return NextResponse.json({
        error: 'PARAMETRO_INVALIDO',
        message: sectionVal.error
      }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
    }

    const canonicalZone = zoneVal.canonicalValue;
    const canonicalSection = sectionVal.canonicalValue;

    // 4. Limite de Registros por Página (Mínimo 1, Máximo 50, Padrão 20)
    let limit = 20;
    if (limitRaw !== null && limitRaw !== undefined) {
      if (!/^\d+$/.test(limitRaw)) {
        return NextResponse.json({
          error: 'PARAMETRO_INVALIDO',
          message: "O parâmetro 'limit' deve ser um número inteiro positivo (mínimo 1, máximo 50)."
        }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
      }
      const parsedLimit = parseInt(limitRaw, 10);
      if (parsedLimit < 1) {
        return NextResponse.json({
          error: 'PARAMETRO_INVALIDO',
          message: "O parâmetro 'limit' deve ser um número inteiro positivo (mínimo 1, máximo 50)."
        }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
      }
      limit = Math.min(50, parsedLimit);
    }

    // 5. Validação e Decodificação do Cursor (Query Binding)
    const currentContext: CursorContext = {
      electionId: election.id,
      roundId: targetRound.id,
      zoneFilter: canonicalZone,
      sectionFilter: canonicalSection
    };

    let cursorPayload = null;
    if (cursorParam) {
      const validation = validateAndDecodeCursor(cursorParam, currentContext);
      if (!validation.valid) {
        return NextResponse.json({
          error: validation.errorCode,
          message: validation.message
        }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
      }
      cursorPayload = validation.cursor;
    }

    // 6. Construção da Cláusula Where Prisma com Keyset Paginado
    const whereClause: Prisma.BallotReportWhereInput = {
      electionId: election.id,
      roundId: targetRound.id,
      status: 'PROCESSADO',
      isSimulation: false,
    };

    if (canonicalZone) {
      whereClause.zoneCode = {
        in: getTerritoryVariants(canonicalZone)
      };
    }

    if (canonicalSection) {
      whereClause.sectionCode = {
        in: getTerritoryVariants(canonicalSection)
      };
    }

    if (cursorPayload) {
      if (cursorPayload.c !== null) {
        // CASO 1: Cursor no Bloco de Confirmados (confirmedAt != null)
        const cDate = new Date(cursorPayload.c);
        const tDate = new Date(cursorPayload.t);

        whereClause.OR = [
          {
            confirmedAt: {
              lt: cDate,
              not: null
            }
          },
          {
            confirmedAt: cDate,
            createdAt: {
              lt: tDate
            }
          },
          {
            confirmedAt: cDate,
            createdAt: tDate,
            id: {
              lt: cursorPayload.i
            }
          },
          {
            confirmedAt: null
          }
        ];
      } else {
        // CASO 2: Cursor no Bloco Histórico (confirmedAt = null)
        // Bloqueia qualquer retorno de confirmados tardios
        const tDate = new Date(cursorPayload.t);

        whereClause.confirmedAt = null;
        whereClause.OR = [
          {
            createdAt: {
              lt: tDate
            }
          },
          {
            createdAt: tDate,
            id: {
              lt: cursorPayload.i
            }
          }
        ];
      }
    }

    // 7. Execução da Busca: take limit + 1 para detecção determinística de hasMore
    const reports = await prisma.ballotReport.findMany({
      where: whereClause,
      orderBy: [
        { confirmedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      take: limit + 1,
      select: {
        id: true,
        stateCode: true,
        cityCode: true,
        zoneCode: true,
        sectionCode: true,
        urnCode: true,
        confirmedAt: true,
        createdAt: true,
        vrqrVersion: true,
        hashStatus: true,
        sigStatus: true,
        validationData: true,
        metadata: true,
        votes: {
          select: {
            quantity: true,
            officeId: true
          }
        }
      }
    });

    const hasMore = reports.length > limit;
    const itemsToReturn = hasMore ? reports.slice(0, limit) : reports;

    // 8. Enriquecimento Territorial em Lote (Prevenção de N+1 por Tríade)
    const triplets = Array.from(new Set(itemsToReturn.map(r => `${r.cityCode}|${r.zoneCode}|${r.sectionCode}`)));
    const sectionLookup = new Map<string, { cityName: string; locationName: string | null }>();

    if (triplets.length > 0) {
      const orClauses = triplets.map(t => {
        const [c, z, s] = t.split('|');
        const sVariants = getTerritoryVariants(s);
        const zVariants = getTerritoryVariants(z);
        return {
          sectionNumber: { in: sVariants },
          zone: {
            zoneNumber: { in: zVariants },
            municipality: { officialCode: c }
          }
        };
      });

      const matchedSections = await prisma.pollingSection.findMany({
        where: { OR: orClauses },
        select: {
          sectionNumber: true,
          locationName: true,
          zone: {
            select: {
              zoneNumber: true,
              municipality: {
                select: {
                  officialCode: true,
                  name: true
                }
              }
            }
          }
        }
      });

      for (const ms of matchedSections) {
        const cCode = ms.zone.municipality.officialCode;
        const zNorm = String(parseInt(ms.zone.zoneNumber, 10) || ms.zone.zoneNumber);
        const sNorm = String(parseInt(ms.sectionNumber, 10) || ms.sectionNumber);
        const key = `${cCode}:${zNorm}:${sNorm}`;
        sectionLookup.set(key, {
          cityName: ms.zone.municipality.name,
          locationName: ms.locationName || null
        });
      }
    }

    // 9. Construção dos DTOs Públicos
    const feedItems: UrnaFeedItemDTO[] = itemsToReturn.map(r => {
      const zNorm = String(parseInt(r.zoneCode, 10) || r.zoneCode);
      const sNorm = String(parseInt(r.sectionCode, 10) || r.sectionCode);
      const lookupKey = `${r.cityCode}:${zNorm}:${sNorm}`;
      const resolved = sectionLookup.get(lookupKey);

      let hasAttendance = false;
      const rawAttData = r.validationData || r.metadata;
      if (rawAttData) {
        try {
          const val = JSON.parse(rawAttData);
          if (
            (val?.attendance && typeof val.attendance.apto === 'number') ||
            typeof val?.aptos === 'number' ||
            typeof val?.apto === 'number'
          ) {
            hasAttendance = true;
          }
        } catch {}
      }

      const totalVotes = r.votes.reduce((acc, v) => acc + (v.quantity || 0), 0);
      const officesCount = new Set(r.votes.map(v => v.officeId)).size;

      const displayTimestamp = (r.confirmedAt || r.createdAt).toISOString();
      const timestampType = r.confirmedAt ? 'CONFIRMED' : 'RECEIVED_FALLBACK';

      return {
        id: r.id,
        territory: {
          stateCode: r.stateCode,
          cityCode: r.cityCode,
          cityName: resolved?.cityName || r.cityCode,
          zoneCode: r.zoneCode,
          sectionCode: r.sectionCode,
          locationName: resolved?.locationName || null,
          urnCode: r.urnCode
        },
        timing: {
          displayTimestamp,
          timestampType
        },
        integrity: {
          vrqrVersion: r.vrqrVersion || null,
          hashStatus: (r.hashStatus as any) || 'UNCHECKED',
          sigStatus: (r.sigStatus as any) || 'UNCHECKED'
        },
        summary: {
          totalVotes,
          officesCount,
          hasAttendance
        }
      };
    });

    // 10. Geração do Próximo Cursor
    const lastItem = itemsToReturn[itemsToReturn.length - 1];
    const nextCursor = (hasMore && lastItem)
      ? encodeUrnaCursor(lastItem.confirmedAt, lastItem.createdAt, lastItem.id, currentContext)
      : null;

    const response: UrnaFeedResponse = {
      context: {
        election: {
          id: election.id,
          slug: election.slug,
          name: election.name,
          year: election.year
        },
        round: {
          id: targetRound.id,
          roundNumber: targetRound.roundNumber,
          status: targetRound.status
        }
      },
      pagination: {
        limit,
        hasMore,
        nextCursor
      },
      filters: {
        zone: canonicalZone,
        section: canonicalSection
      },
      items: feedItems
    };

    return NextResponse.json(response, { headers: { 'Cache-Control': CACHE_HEADER } });
  } catch (error: any) {
    return NextResponse.json({
      error: 'ERRO_INTERNO',
      message: 'Ocorreu um erro interno ao processar a consulta de urnas.'
    }, { status: 500, headers: { 'Cache-Control': CACHE_HEADER } });
  }
}

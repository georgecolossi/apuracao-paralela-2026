import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateRadioScript } from '@/lib/presentation/radioScriptGenerator';
import { UrnaDetailDTO, OfficeVotesDTO, CandidateVoteDTO, PartyVoteDTO } from '@/lib/presentation/pressDto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_HEADER = 'public, max-age=5, s-maxage=5, stale-while-revalidate=10';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({
        error: 'ID_INVALIDO',
        message: 'Identificador de boletim inválido.'
      }, { status: 400, headers: { 'Cache-Control': CACHE_HEADER } });
    }

    // Fail-Closed: Estritamente PROCESSADO e isSimulation = false
    const report = await prisma.ballotReport.findFirst({
      where: {
        id,
        status: 'PROCESSADO',
        isSimulation: false
      },
      include: {
        election: {
          select: { id: true, name: true, year: true }
        },
        round: {
          select: { id: true, roundNumber: true }
        },
        votes: {
          include: {
            office: true,
            candidate: {
              include: { party: true }
            },
            party: true
          }
        }
      }
    });

    if (!report) {
      return NextResponse.json({
        error: 'BOLETIM_NAO_DISPONIVEL',
        message: 'Boletim de Urna não encontrado ou não disponível para consulta pública.'
      }, { status: 404, headers: { 'Cache-Control': CACHE_HEADER } });
    }

    // Resolução Territorial Estrita por Tríade (cityCode + zoneCode + sectionCode)
    const sVariants = Array.from(new Set([report.sectionCode, report.sectionCode.padStart(4, '0'), String(parseInt(report.sectionCode, 10) || report.sectionCode)]));
    const zVariants = Array.from(new Set([report.zoneCode, report.zoneCode.padStart(4, '0'), String(parseInt(report.zoneCode, 10) || report.zoneCode)]));

    const sectionInDB = await prisma.pollingSection.findFirst({
      where: {
        sectionNumber: { in: sVariants },
        zone: {
          zoneNumber: { in: zVariants },
          municipality: { officialCode: report.cityCode }
        }
      },
      select: {
        locationName: true,
        zone: {
          select: {
            municipality: {
              select: { name: true }
            }
          }
        }
      }
    });

    const cityName = sectionInDB?.zone?.municipality?.name || report.cityCode;
    const locationName = sectionInDB?.locationName || null;

    // Resolução de Metadados de Comparecimento
    let attendanceDTO = null;
    const rawAttData = report.validationData || report.metadata;
    if (rawAttData) {
      try {
        const val = JSON.parse(rawAttData);
        const apto = typeof val?.attendance?.apto === 'number' ? val.attendance.apto : typeof val?.aptos === 'number' ? val.aptos : typeof val?.apto === 'number' ? val.apto : null;
        const comp = typeof val?.attendance?.comp === 'number' ? val.attendance.comp : typeof val?.comparecimento === 'number' ? val.comparecimento : typeof val?.comp === 'number' ? val.comp : null;
        const falt = typeof val?.attendance?.falt === 'number' ? val.attendance.falt : typeof val?.faltas === 'number' ? val.faltas : typeof val?.falt === 'number' ? val.falt : null;

        if (apto !== null && typeof apto === 'number') {
          let turnoutPercent = null;
          let abstentionPercent = null;
          if (apto > 0 && comp !== null) {
            turnoutPercent = ((comp / apto) * 100).toFixed(2).replace('.', ',') + '%';
          }
          if (apto > 0 && falt !== null) {
            abstentionPercent = ((falt / apto) * 100).toFixed(2).replace('.', ',') + '%';
          }

          attendanceDTO = {
            available: true,
            apto,
            comp,
            falt,
            turnoutPercent,
            abstentionPercent
          };
        }
      } catch {}
    }

    // Agrupamento por Cargo com Isolamento por officeId
    const officesMap = new Map<string, {
      officeId: string;
      officeName: string;
      officeCode: string;
      type: string;
      orderNumber: number;
      validVotes: number;
      blankVotes: number;
      nullVotes: number;
      totalVotes: number;
      candidatesMap: Map<string, {
        candidateNumber: string;
        ballotName: string;
        partyNumber: string | null;
        partyAbbreviation: string | null;
        votes: number;
      }>;
      partiesMap: Map<string, {
        partyNumber: string;
        partyAbbreviation: string | null;
        partyName: string | null;
        votes: number;
      }>;
    }>();

    for (const v of report.votes) {
      const off = v.office;
      if (!officesMap.has(off.id)) {
        officesMap.set(off.id, {
          officeId: off.id,
          officeName: off.name,
          officeCode: off.code,
          type: off.type,
          orderNumber: off.orderNumber,
          validVotes: 0,
          blankVotes: 0,
          nullVotes: 0,
          totalVotes: 0,
          candidatesMap: new Map(),
          partiesMap: new Map()
        });
      }

      const officeAgg = officesMap.get(off.id)!;
      const qty = v.quantity || 0;
      officeAgg.totalVotes += qty;

      if (v.voteType === 'NOMINAL') {
        officeAgg.validVotes += qty;
        const candNum = v.candidateNumber || (v.candidate?.candidateNumber ?? 'S/N');
        const ballotName = v.candidate?.ballotName || v.candidate?.name || `Candidato ${candNum}`;
        const partyNumber = v.candidate?.party?.officialIdentifier || v.partyNumber || null;
        const partyAbbr = v.candidate?.party?.abbreviation || null;

        if (!officeAgg.candidatesMap.has(candNum)) {
          officeAgg.candidatesMap.set(candNum, {
            candidateNumber: candNum,
            ballotName,
            partyNumber,
            partyAbbreviation: partyAbbr,
            votes: 0
          });
        }
        officeAgg.candidatesMap.get(candNum)!.votes += qty;
      } else if (v.voteType === 'LEGENDA') {
        officeAgg.validVotes += qty;
        const partyNum = v.partyNumber || v.party?.officialIdentifier || 'S/N';
        const partyAbbr = v.party?.abbreviation || null;
        const partyName = v.party?.name || null;

        if (!officeAgg.partiesMap.has(partyNum)) {
          officeAgg.partiesMap.set(partyNum, {
            partyNumber: partyNum,
            partyAbbreviation: partyAbbr,
            partyName,
            votes: 0
          });
        }
        officeAgg.partiesMap.get(partyNum)!.votes += qty;
      } else if (v.voteType === 'BRANCO') {
        officeAgg.blankVotes += qty;
      } else if (v.voteType === 'NULO') {
        officeAgg.nullVotes += qty;
      }
    }

    // Ordenação e cálculo de percentuais
    const sortedOffices = Array.from(officesMap.values()).sort((a, b) => a.orderNumber - b.orderNumber);

    const officesDTO: OfficeVotesDTO[] = sortedOffices.map(o => {
      const candidates: CandidateVoteDTO[] = Array.from(o.candidatesMap.values())
        .sort((a, b) => {
          if (b.votes !== a.votes) return b.votes - a.votes;
          const numA = parseInt(a.candidateNumber, 10) || 0;
          const numB = parseInt(b.candidateNumber, 10) || 0;
          if (numA !== numB) return numA - numB;
          return a.ballotName.localeCompare(b.ballotName);
        })
        .map(c => ({
          candidateNumber: c.candidateNumber,
          ballotName: c.ballotName,
          partyNumber: c.partyNumber,
          partyAbbreviation: c.partyAbbreviation,
          votes: c.votes,
          percent: o.validVotes > 0
            ? ((c.votes / o.validVotes) * 100).toFixed(2).replace('.', ',') + '%'
            : '0,00%'
        }));

      const parties: PartyVoteDTO[] = Array.from(o.partiesMap.values())
        .sort((a, b) => b.votes - a.votes)
        .map(p => ({
          partyNumber: p.partyNumber,
          partyAbbreviation: p.partyAbbreviation,
          partyName: p.partyName,
          votes: p.votes,
          percent: o.validVotes > 0
            ? ((p.votes / o.validVotes) * 100).toFixed(2).replace('.', ',') + '%'
            : '0,00%'
        }));

      return {
        officeId: o.officeId,
        officeName: o.officeName,
        officeCode: o.officeCode,
        type: o.type,
        summary: {
          validVotes: o.validVotes,
          blankVotes: o.blankVotes,
          nullVotes: o.nullVotes,
          totalVotes: o.totalVotes
        },
        candidates,
        parties
      };
    });

    const displayTimestamp = (report.confirmedAt || report.createdAt).toISOString();
    const timestampType = report.confirmedAt ? 'CONFIRMED' : 'RECEIVED_FALLBACK';

    const detailDTO: UrnaDetailDTO = {
      id: report.id,
      context: {
        election: {
          id: report.election.id,
          name: report.election.name,
          year: report.election.year
        },
        round: {
          id: report.round.id,
          roundNumber: report.round.roundNumber
        }
      },
      territory: {
        stateCode: report.stateCode,
        cityCode: report.cityCode,
        cityName,
        zoneCode: report.zoneCode,
        sectionCode: report.sectionCode,
        locationName,
        urnCode: report.urnCode
      },
      timing: {
        receivedAt: report.createdAt.toISOString(),
        confirmedAt: report.confirmedAt ? report.confirmedAt.toISOString() : null,
        displayTimestamp,
        timestampType
      },
      integrity: {
        vrqrVersion: report.vrqrVersion || null,
        hash: report.hash || null,
        hashStatus: (report.hashStatus as any) || 'UNCHECKED',
        sigStatus: (report.sigStatus as any) || 'UNCHECKED',
        note: report.hashStatus === 'VERIFIED'
          ? 'Integridade SHA-512 do Boletim de Urna verificada com sucesso. Assinatura digital da urna não autenticada offline.'
          : 'Integridade SHA-512 não verificada.'
      },
      attendance: attendanceDTO,
      offices: officesDTO,
      radioScript: ''
    };

    detailDTO.radioScript = generateRadioScript(detailDTO);

    return NextResponse.json(detailDTO, { headers: { 'Cache-Control': CACHE_HEADER } });
  } catch (error) {
    return NextResponse.json({
      error: 'ERRO_INTERNO',
      message: 'Erro interno ao consultar detalhamento do boletim.'
    }, { status: 500, headers: { 'Cache-Control': CACHE_HEADER } });
  }
}

import { NextResponse } from 'next/server';

const TSE_BASE_URL = 'https://resultados.tse.jus.br/oficial';

async function fetchEA20(eleCode: string, uf: string, muniCode: string, cargoCode: string) {
  const url = `${TSE_BASE_URL}/ele2026/${eleCode}/dados/${uf.toLowerCase()}/${uf.toLowerCase()}${muniCode}-c${cargoCode.padStart(4, '0')}-e${eleCode.padStart(6, '0')}-u.json`;
  
  try {
    const res = await fetch(url, { next: { revalidate: 30 } }); // Cache 30 seconds
    if (!res.ok) {
      if (res.status === 404) return { status: 'NOT_YET_AVAILABLE', cargo: cargoCode };
      return { status: 'TEMPORARILY_UNAVAILABLE', cargo: cargoCode };
    }
    const data = await res.json();
    return { status: 'AVAILABLE', cargo: cargoCode, data };
  } catch (error) {
    return { status: 'TEMPORARILY_UNAVAILABLE', cargo: cargoCode };
  }
}

async function fetchEleC() {
  const url = `${TSE_BASE_URL}/ele2026/arquivo/ele-c.json`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const round = searchParams.get('round');
  const uf = 'sc';
  const muni = '80837';

  if (!round) return NextResponse.json({ error: 'Round missing' }, { status: 400 });

  let federalEle = '';
  let estadualEle = '';

  const eleC = await fetchEleC();
  if (eleC && eleC.eleicoes) {
    const roundEles = eleC.eleicoes.filter((e: any) => e.t === round);
    // Find federal vs estadual by looking at cargos or id
    // This is robust if ele-c is present
    for (const e of roundEles) {
      if (e.cd.endsWith('7') || e.cd.endsWith('8')) federalEle = e.cd;
      if (e.cd.endsWith('9') || e.cd.endsWith('0')) estadualEle = e.cd;
    }
  }

  // Fallback for Round 1 since we know it exists and might not have ele-c
  if (round === '1' && (!federalEle || !estadualEle)) {
    federalEle = '6257';
    estadualEle = '6259';
  }

  if (!federalEle || !estadualEle) {
    return NextResponse.json({
      status: 'NOT_YET_AVAILABLE',
      message: 'Configurao da eleio (ele-c) no encontrada para o turno ' + round
    });
  }

  const results = await Promise.all([
    fetchEA20(federalEle, uf, muni, '1'), // Presidente
    fetchEA20(estadualEle, uf, muni, '3'), // Governador
    fetchEA20(estadualEle, uf, muni, '5'), // Senador
    fetchEA20(estadualEle, uf, muni, '6'), // Dep Federal
    fetchEA20(estadualEle, uf, muni, '7'), // Dep Estadual
  ]);

  const parsedOffices = results.map(r => {
    if (r.status !== 'AVAILABLE') return r;
    const j = r.data;
    
    // Validate
    if (j.cdabr !== muni || j.t !== round) {
      return { status: 'INVALID_RESPONSE', cargo: r.cargo };
    }

    const firstCarg = j.carg?.[0];
    if (!firstCarg) return { status: 'INVALID_RESPONSE', cargo: r.cargo };

    const candidates = firstCarg.agr?.flatMap((a: any) => 
      a.par?.flatMap((p: any) => 
        p.cand?.map((c: any) => ({
          number: c.n,
          name: c.nmu,
          votes: parseInt(c.vap || '0', 10),
          percent: c.pvap || '0,00'
        }))
      )
    ) || [];

    // Sort by votes
    candidates.sort((a: any, b: any) => b.votes - a.votes);

    return {
      status: 'AVAILABLE',
      cargo: r.cargo,
      cargoName: firstCarg.nmf,
      progress: {
        total: parseInt(j.s?.ts || '0', 10),
        processed: parseInt(j.s?.st || '0', 10),
        percent: j.s?.pst || '0,00'
      },
      attendance: {
        eligible: parseInt(j.e?.te || '0', 10),
        turnout: parseInt(j.e?.c || '0', 10),
        turnoutPercent: j.e?.pc || '0,00',
        abstention: parseInt(j.e?.a || '0', 10),
        abstentionPercent: j.e?.pa || '0,00'
      },
      validVotes: {
        quantity: parseInt(j.v?.vvc || '0', 10),
        percent: j.v?.pvvc || '0,00'
      },
      blankVotes: {
        quantity: parseInt(j.v?.vb || '0', 10),
        percent: j.v?.pvb || '0,00'
      },
      nullVotes: {
        quantity: parseInt(j.v?.tvn || '0', 10), // Total nulos
        percent: j.v?.ptvn || '0,00'
      },
      candidates
    };
  });

  // Overall status is NOT_YET_AVAILABLE if all are NOT_YET_AVAILABLE
  const overallStatus = parsedOffices.every(o => o.status === 'NOT_YET_AVAILABLE') ? 'NOT_YET_AVAILABLE' : 'AVAILABLE';

  return NextResponse.json({
    source: 'TSE',
    round,
    municipality: muni,
    status: overallStatus,
    offices: parsedOffices
  });
}

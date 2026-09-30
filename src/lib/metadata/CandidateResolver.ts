import { prisma } from '../db';

export type CandidateResolutionStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';

export interface ResolvedCandidate {
  status: CandidateResolutionStatus;
  candidateName?: string;
  partyNumber?: string;
  partyAbbreviation?: string;
}

export class CandidateResolver {
  private metadataMap: Map<string, { officeCode: string; candidateNumber: string; ballotName: string; partyNumber: string; partyAbbreviation: string; }[]> = new Map();

  async load(electionCode: string, state: string) {
    const whereClause: Record<string, unknown> = {
      state: { in: [state, 'BR'] }
    };
    if (electionCode) {
      whereClause.electionCode = electionCode;
    }

    const records = await prisma.candidateMetadata.findMany({
      where: whereClause
    });

    for (const record of records) {
      // Chave baseada no contexto + cargo + número (se disponível)
      // O partyNumber para legenda não tem candidateNumber, então criamos uma chave
      // específica se precisarmos de fallback, mas a prioridade da Fase 7.3 é voto NOMINAL.
      const key = `${record.officeCode}|${record.candidateNumber}`;
      const list = this.metadataMap.get(key) || [];
      list.push(record);
      this.metadataMap.set(key, list);
    }
  }

  resolveNominal(officeCode: string, candidateNumber: string): ResolvedCandidate {
    const key = `${officeCode}|${candidateNumber}`;
    const matches = this.metadataMap.get(key);

    if (!matches || matches.length === 0) {
      return { status: 'NOT_FOUND' };
    }

    if (matches.length > 1) {
      return { status: 'AMBIGUOUS' };
    }

    const match = matches[0];
    return {
      status: 'FOUND',
      candidateName: match.ballotName,
      partyNumber: match.partyNumber,
      partyAbbreviation: match.partyAbbreviation
    };
  }

  // Legenda fallback - busca pelo número do partido para tentar extrair a sigla
  resolveLegenda(officeCode: string, partyNumber: string): ResolvedCandidate {
    // Como um partido pode ter N candidatos com o mesmo officeCode, iteramos
    // para encontrar qualquer registro que contenha a sigla desse partido.
    // Isso é um fallback seguro para legenda sem inventar candidatos fictícios.
    let partyAbbreviation = '';
    
    for (const list of this.metadataMap.values()) {
      for (const record of list) {
        if (record.officeCode === officeCode && record.partyNumber === partyNumber) {
          partyAbbreviation = record.partyAbbreviation;
          break;
        }
      }
      if (partyAbbreviation) break;
    }

    if (!partyAbbreviation) {
      return { status: 'NOT_FOUND' };
    }

    return {
      status: 'FOUND',
      partyNumber,
      partyAbbreviation
    };
  }
}

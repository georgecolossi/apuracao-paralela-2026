import { prisma } from '../db';

export type CandidateResolutionStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';

export interface ResolvedCandidate {
  status: CandidateResolutionStatus;
  candidateName?: string;
  partyNumber?: string;
  partyAbbreviation?: string;
}

export class CandidateResolver {
  // key: `${electionYear}|${state}|${officeCode}|${candidateNumber}`
  private metadataMap: Map<string, { officeCode: string; candidateNumber: string; ballotName: string; partyNumber: string; partyAbbreviation: string; state: string; electionYear: number; }[]> = new Map();

  async load(electionYear: number, round: number) {
    const records = await prisma.candidateMetadata.findMany({
      where: { electionYear, round }
    });

    for (const record of records) {
      const key = `${record.electionYear}|${record.round}|${record.state}|${record.officeCode}|${record.candidateNumber}`;
      const list = this.metadataMap.get(key) || [];
      list.push(record);
      this.metadataMap.set(key, list);
    }
  }

  resolveNominal(electionYear: number, round: number, state: string, officeCode: string, candidateNumber: string): ResolvedCandidate {
    const key = `${electionYear}|${round}|${state}|${officeCode}|${candidateNumber}`;
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

  resolveLegenda(electionYear: number, round: number, state: string, officeCode: string, partyNumber: string): ResolvedCandidate {
    let partyAbbreviation = '';
    
    for (const list of this.metadataMap.values()) {
      for (const record of list) {
        if (record.electionYear === electionYear && (record as any).round === round && record.state === state && record.officeCode === officeCode && record.partyNumber === partyNumber) {
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

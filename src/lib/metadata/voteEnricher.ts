import { CandidateResolver } from './CandidateResolver';

export const OFFICE_NAME_TO_CODE: Record<string, string> = {
  'Presidente': '1',
  'Governador': '3',
  'Senador': '5',
  'Deputado Federal': '6',
  'Deputado Estadual': '7',
  'Prefeito': '11',
  'Vereador': '13'
};

export type EnrichedVoteMeta = {
  status: 'NOT_FOUND' | 'FOUND' | 'AMBIGUOUS';
  candidateName?: string;
  partyAbbreviation?: string;
  partyNumber?: string;
};

export function enrichVoteWithMetadata(
  vote: { voteType: string; candidateNumber: string | null; partyNumber: string | null; officeName: string },
  electionYear: number,
  round: number,
  reportStateCode: string,
  resolver: CandidateResolver
): EnrichedVoteMeta {
  const officeCode = OFFICE_NAME_TO_CODE[vote.officeName];
  if (!officeCode) return { status: 'NOT_FOUND' };

  // Presidente usa BR, demais usam UF do próprio relatório
  const stateContext = officeCode === '1' ? 'BR' : reportStateCode;

  if (vote.voteType === 'NOMINAL' && vote.candidateNumber) {
    return resolver.resolveNominal(electionYear, round, stateContext, officeCode, vote.candidateNumber);
  } else if (vote.voteType === 'LEGENDA' && vote.partyNumber) {
    return resolver.resolveLegenda(electionYear, round, stateContext, officeCode, vote.partyNumber);
  }

  return { status: 'NOT_FOUND' };
}

import { SignatureVerifier, HashVerifier, VerificationState } from '../crypto';

export type ParseError = {
  code: string;
  message: string;
  details?: any;
};

export type BallotVote = {
  officeName: string;
  candidateNumber?: string;
  partyNumber?: string;
  type: 'NOMINAL' | 'LEGENDA' | 'BRANCO' | 'NULO';
  quantity: number;
};

export type BallotReportData = {
  electionId: string;
  roundNumber: number;
  stateCode: string;
  cityCode: string;
  zoneCode: string;
  sectionCode: string;
  urnCode: string;
  votes: BallotVote[];
  hash: string;
  signature: string;
  hashStatus?: VerificationState;
  sigStatus?: VerificationState;
  warnings?: string[];
};

export interface BallotReportParser {
  parsePart(content: string): { partIndex: number; totalParts: number; sequenceId: string; payload: string } | ParseError;
  reconstruct(parts: string[]): string | ParseError;
  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError;
}



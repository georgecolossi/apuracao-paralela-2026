import { SignatureVerifier, HashVerifier, VerificationState } from '../crypto';

export type ParseError = {
  code: string;
  message: string;
  details?: unknown;
};

export type BallotVote = {
  officeCode?: string;
  officeName: string;
  officeType?: 'MAJORITARIO' | 'PROPORCIONAL' | 'CONSULTA';
  candidateNumber?: string;
  partyNumber?: string;
  type: 'NOMINAL' | 'LEGENDA' | 'BRANCO' | 'NULO';
  quantity: number;
  electionPlei?: string;
};

export type BallotReportData = {
  electionId: string;
  specificElectionId?: string;
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
  sigValidationNote?: string;
  fase?: string;
  vrqrVersion?: string;
  warnings?: string[];
  apto?: number;
  comp?: number;
  falt?: number;
  rawPayload?: string;
};

export interface BallotReportParser {
  parsePart(content: string): { partIndex: number; totalParts: number; sequenceId: string; payload: string } | ParseError;
  reconstruct(parts: string[]): string | ParseError;
  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError;
}

export * from './adapter/QrBuAdapter';
export * from './adapter/UniversalQrBuParser';
export * from './adapter/Vrqr6Adapter';
export * from './adapter/Vrqr5Adapter';
export * from './adapter/Vrqr4Adapter';

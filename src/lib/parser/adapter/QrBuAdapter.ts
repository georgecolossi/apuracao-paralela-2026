/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR UNIVERSAL DE QRBU
 * 
 * Interface para adaptadores de Boletim de Urna (QRBU) versionados.
 * Suporta formatos oficiais TSE (VRQR 4.0, 5.0, 6.0) e simulações.
 */

import { VerificationState } from '../../crypto';

export type ParseErrorCode =
  | 'INVALID_HEADER'
  | 'INVALID_PART_INDEX'
  | 'TOTAL_MISMATCH'
  | 'DUPLICATE_PARTS'
  | 'MISSING_PARTS'
  | 'TOO_MANY_PARTS'
  | 'NO_PARTS'
  | 'UNSUPPORTED_VRQR_VERSION'
  | 'UNHOMOLOGATED_VRQR_VERSION'
  | 'MISSING_FIELDS'
  | 'INVALID_HASH'
  | 'INVALID_VOTE_DATA'
  | 'INVALID_OFFICE_CODE'
  | 'INVALID_OFFICE_FOR_LAYOUT'
  | 'VOTE_TOTAL_MISMATCH'
  | 'DISPLACED_VOTE_TOKEN'
  | 'DUPLICATE_OFFICE_FIELD'
  | 'DUPLICATE_SUMMARY_FIELD'
  | 'INCOMPLETE_OFFICE_BLOCK'
  | 'INCOMPLETE_SUMMARY_BLOCK'
  | 'SUMMARY_TOTAL_MISMATCH'
  | 'CORRUPTED_PAYLOAD';

export interface ParseError {
  code: ParseErrorCode | string;
  message: string;
  details?: unknown;
}

export interface QrPartInfo {
  partIndex: number;
  totalParts: number;
  vrqrVersion: string;
  sequenceId: string;
  payload: string;
  rawContent: string;
}

export type VoteType = 'NOMINAL' | 'LEGENDA' | 'BRANCO' | 'NULO';

export interface BallotVote {
  officeCode?: string;
  officeName: string;
  officeType?: 'MAJORITARIO' | 'PROPORCIONAL' | 'CONSULTA';
  candidateNumber?: string;
  partyNumber?: string;
  type: VoteType;
  quantity: number;
  electionPlei?: string;
}

export interface BallotReportData {
  electionId: string;
  specificElectionId?: string;
  roundNumber: number;
  stateCode: string;
  cityCode: string;
  zoneCode: string;
  sectionCode: string;
  urnCode: string;
  vrqrVersion?: string;
  hash: string;
  signature: string;
  hashStatus?: VerificationState;
  sigStatus?: VerificationState;
  sigValidationNote?: string;
  fase?: string;
  votes: BallotVote[];
  metadata?: Record<string, string>;
  apto?: number;
  comp?: number;
  falt?: number;
  warnings?: string[];
  rawPayload?: string;
}

export interface QrBuAdapter {
  readonly version: string;
  readonly supportedFormats: string[];
  readonly description: string;

  canHandle(content: string): boolean;
  parsePart(content: string): QrPartInfo | ParseError;
  reconstruct(parts: string[]): string | ParseError;
  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError;
}

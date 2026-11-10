export type TimestampType = 'CONFIRMED' | 'RECEIVED_FALLBACK';
export type CryptographicStatus = 'VERIFIED' | 'FAILED' | 'UNCHECKED';

export interface TerritoryDTO {
  stateCode: string;
  cityCode: string;
  cityName: string;
  zoneCode: string;
  sectionCode: string;
  locationName: string | null;
  urnCode?: string;
}

export interface TimingDTO {
  receivedAt?: string;
  confirmedAt?: string | null;
  displayTimestamp: string;
  timestampType: TimestampType;
}

export interface IntegrityDTO {
  vrqrVersion: string | null;
  hash?: string | null;
  hashStatus: CryptographicStatus;
  sigStatus: CryptographicStatus;
  note?: string;
}

export interface AttendanceDTO {
  available: boolean;
  apto: number | null;
  comp: number | null;
  falt: number | null;
  turnoutPercent: string | null;
  abstentionPercent: string | null;
}

export interface CandidateVoteDTO {
  candidateNumber: string;
  ballotName: string;
  partyNumber: string | null;
  partyAbbreviation: string | null;
  votes: number;
  percent: string;
}

export interface PartyVoteDTO {
  partyNumber: string;
  partyAbbreviation: string | null;
  partyName: string | null;
  votes: number;
  percent: string;
}

export interface OfficeVotesDTO {
  officeId: string;
  officeName: string;
  officeCode: string;
  type: string; // MAJORITARIO | PROPORCIONAL
  summary: {
    validVotes: number;
    blankVotes: number;
    nullVotes: number;
    totalVotes: number;
  };
  candidates: CandidateVoteDTO[];
  parties: PartyVoteDTO[];
}

export interface UrnaFeedItemDTO {
  id: string;
  territory: TerritoryDTO;
  timing: TimingDTO;
  integrity: IntegrityDTO;
  summary: {
    totalVotes: number;
    officesCount: number;
    hasAttendance: boolean;
  };
}

export interface UrnaDetailDTO {
  id: string;
  context: {
    election: { id: string; name: string; year: number };
    round: { id: string; roundNumber: number };
  };
  territory: TerritoryDTO;
  timing: TimingDTO;
  integrity: IntegrityDTO;
  attendance: AttendanceDTO | null;
  offices: OfficeVotesDTO[];
  radioScript: string;
}

export interface UrnaFeedResponse {
  context: {
    election: { id: string; slug: string; name: string; year: number } | null;
    round: { id: string; roundNumber: number; status: string } | null;
  } | null;
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  filters: {
    zone: string | null;
    section: string | null;
  };
  items: UrnaFeedItemDTO[];
  message?: string;
}

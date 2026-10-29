-- ==============================================================================
-- BASELINE INITIALIZATION: Apuração Paralela 2.0 (Instalação Limpa)
-- ==============================================================================
-- Esta migration estabelece o modelo relacional universal da plataforma v2.0
-- para instalações limpas a partir de um banco de dados novo e vazio.
-- 
-- NOTA ARQUITETURAL:
-- A versão 2.0 desacopla cargos de municípios, elimina a colisão global de
-- candidatos e introduz escopos configuráveis. Ambientes legados de 2026
-- requerem inicialização limpa (Clean First-Run) ou procedimento homologado.
-- ==============================================================================

-- CreateTable: Election
CREATE TABLE "Election" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "plei" TEXT,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: ElectionRound
CREATE TABLE "ElectionRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "plei" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "coverageStatus" TEXT NOT NULL DEFAULT 'PROVISIONAL',
    "coverageOrigin" TEXT,
    "coverageHomologatedAt" DATETIME,
    "coverageHomologatedBy" TEXT,
    "coverageHomologationType" TEXT,
    "coverageEvidenceNotes" TEXT,
    "date" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ElectionRound_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: ElectionScope
CREATE TABLE "ElectionScope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'MUNICIPAL',
    "scopeKey" TEXT NOT NULL,
    "stateId" TEXT,
    "municipalityId" TEXT,
    "isCoverageArea" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ElectionScope_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ElectionScope_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ElectionScope_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: State
CREATE TABLE "State" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL
);

-- CreateTable: Municipality
CREATE TABLE "Municipality" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "ibgeCode" TEXT,
    "isCoverage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Municipality_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: PollingZone
CREATE TABLE "PollingZone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "municipalityId" TEXT NOT NULL,
    "zoneNumber" TEXT NOT NULL,
    "expectedBUs" INTEGER DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PollingZone_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: PollingSection
CREATE TABLE "PollingSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollingZoneId" TEXT NOT NULL,
    "sectionNumber" TEXT NOT NULL,
    "isAggregated" BOOLEAN NOT NULL DEFAULT false,
    "aggregatedIntoSec" TEXT,
    "expectedBUs" INTEGER DEFAULT 1,
    "locationName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PollingSection_pollingZoneId_fkey" FOREIGN KEY ("pollingZoneId") REFERENCES "PollingZone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: PollingStation
CREATE TABLE "PollingStation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "urnCode" TEXT NOT NULL,
    "metadata" TEXT,
    CONSTRAINT "PollingStation_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "PollingSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: RoundCoverage
CREATE TABLE "RoundCoverage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionRoundId" TEXT NOT NULL,
    "pollingSectionId" TEXT NOT NULL,
    "expectedBUs" INTEGER NOT NULL DEFAULT 1,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoundCoverage_electionRoundId_fkey" FOREIGN KEY ("electionRoundId") REFERENCES "ElectionRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundCoverage_pollingSectionId_fkey" FOREIGN KEY ("pollingSectionId") REFERENCES "PollingSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: Office
CREATE TABLE "Office" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MAJORITARIO',
    "orderNumber" INTEGER NOT NULL DEFAULT 1,
    "maxVotesPerVoter" INTEGER NOT NULL DEFAULT 1,
    "configuration" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Office_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: Party
CREATE TABLE "Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "officialIdentifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: Candidate
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "officeId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "candidateNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ballotName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Candidate_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Candidate_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: CandidateMetadata
CREATE TABLE "CandidateMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateSequence" TEXT NOT NULL,
    "electionYear" INTEGER NOT NULL,
    "electionCode" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "officeCode" TEXT NOT NULL,
    "officeName" TEXT NOT NULL,
    "candidateNumber" TEXT NOT NULL,
    "ballotName" TEXT NOT NULL,
    "partyNumber" TEXT NOT NULL,
    "partyAbbreviation" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "source" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: ScanSession
CREATE TABLE "ScanSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sequenceId" TEXT NOT NULL,
    "operatorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expectedParts" INTEGER NOT NULL,
    "isSimulation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScanSession_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: BallotReport
CREATE TABLE "BallotReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deterministicId" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "sectionCode" TEXT NOT NULL,
    "urnCode" TEXT NOT NULL,
    "vrqrVersion" TEXT,
    "hash" TEXT,
    "signature" TEXT,
    "hashStatus" TEXT NOT NULL DEFAULT 'UNCHECKED',
    "sigStatus" TEXT NOT NULL DEFAULT 'UNCHECKED',
    "status" TEXT NOT NULL DEFAULT 'RECEBIDO',
    "isSimulation" BOOLEAN NOT NULL DEFAULT false,
    "operatorId" TEXT,
    "validationData" TEXT,
    "metadata" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BallotReport_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BallotReport_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ElectionRound" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BallotReport_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: BallotReportPart
CREATE TABLE "BallotReportPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT,
    "sessionId" TEXT NOT NULL,
    "partIndex" INTEGER NOT NULL,
    "totalParts" INTEGER NOT NULL,
    "rawContent" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STORED',
    "operatorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BallotReportPart_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScanSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BallotReportPart_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BallotReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BallotReportPart_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: BallotVote
CREATE TABLE "BallotVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "candidateId" TEXT,
    "candidateNumber" TEXT,
    "partyId" TEXT,
    "partyNumber" TEXT,
    "voteType" TEXT NOT NULL DEFAULT 'NOMINAL',
    "quantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BallotVote_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BallotReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BallotVote_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BallotVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BallotVote_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: User
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "electionId" TEXT,
    "roundId" TEXT,
    "reportId" TEXT,
    "action" TEXT NOT NULL,
    "identifiers" TEXT,
    "result" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "errors" TEXT,
    "ipAddress" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ElectionRound" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BallotReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: TseSyncConfig
CREATE TABLE "TseSyncConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "configKey" TEXT NOT NULL,
    "officeCode" TEXT,
    "officialElectionCode" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'MUNICIPAL',
    "uf" TEXT,
    "muniTseCode" TEXT,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" DATETIME,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "syncIntervalSeconds" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TseSyncConfig_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: ProcessingError
CREATE TABLE "ProcessingError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "errorCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndexes: Constraints e Chaves Únicas
CREATE UNIQUE INDEX "Election_slug_key" ON "Election"("slug");
CREATE UNIQUE INDEX "ElectionRound_electionId_roundNumber_key" ON "ElectionRound"("electionId", "roundNumber");
CREATE UNIQUE INDEX "ElectionScope_electionId_scopeKey_key" ON "ElectionScope"("electionId", "scopeKey");
CREATE UNIQUE INDEX "State_abbreviation_key" ON "State"("abbreviation");
CREATE UNIQUE INDEX "Municipality_officialCode_key" ON "Municipality"("officialCode");
CREATE UNIQUE INDEX "PollingZone_municipalityId_zoneNumber_key" ON "PollingZone"("municipalityId", "zoneNumber");
CREATE UNIQUE INDEX "PollingSection_pollingZoneId_sectionNumber_key" ON "PollingSection"("pollingZoneId", "sectionNumber");
CREATE UNIQUE INDEX "RoundCoverage_electionRoundId_pollingSectionId_key" ON "RoundCoverage"("electionRoundId", "pollingSectionId");
CREATE UNIQUE INDEX "Office_electionId_code_key" ON "Office"("electionId", "code");
CREATE UNIQUE INDEX "Party_officialIdentifier_key" ON "Party"("officialIdentifier");
CREATE UNIQUE INDEX "Candidate_officeId_candidateNumber_key" ON "Candidate"("officeId", "candidateNumber");
CREATE UNIQUE INDEX "CandidateMetadata_candidateSequence_key" ON "CandidateMetadata"("candidateSequence");
CREATE UNIQUE INDEX "ScanSession_sequenceId_key" ON "ScanSession"("sequenceId");
CREATE UNIQUE INDEX "BallotReport_deterministicId_key" ON "BallotReport"("deterministicId");
CREATE UNIQUE INDEX "BallotReportPart_sessionId_partIndex_key" ON "BallotReportPart"("sessionId", "partIndex");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "TseSyncConfig_electionId_configKey_key" ON "TseSyncConfig"("electionId", "configKey");
CREATE INDEX "TseSyncConfig_electionId_roundNumber_idx" ON "TseSyncConfig"("electionId", "roundNumber");

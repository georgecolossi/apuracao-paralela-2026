-- CreateTable
CREATE TABLE "CandidateMetadata" (
    "id" TEXT NOT NULL,
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
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateMetadata_candidateSequence_key" ON "CandidateMetadata"("candidateSequence");

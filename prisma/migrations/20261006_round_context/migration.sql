-- AlterTable
ALTER TABLE "ElectionRound" ADD COLUMN "plei" TEXT;

-- CreateTable
CREATE TABLE "RoundCoverage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionRoundId" TEXT NOT NULL,
    "pollingSectionId" TEXT NOT NULL,
    "expectedBUs" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "RoundCoverage_electionRoundId_fkey" FOREIGN KEY ("electionRoundId") REFERENCES "ElectionRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoundCoverage_pollingSectionId_fkey" FOREIGN KEY ("pollingSectionId") REFERENCES "PollingSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RoundCoverage_electionRoundId_pollingSectionId_key" ON "RoundCoverage"("electionRoundId", "pollingSectionId");

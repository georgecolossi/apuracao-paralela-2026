import { executeApplyTransaction } from "../scripts/bu-dat/run_dry_run";
import { prisma } from "../src/lib/db";
import { describe, it, expect, beforeEach } from "vitest";

describe("Apply Transaction Behavior", () => {
    let mockElection: any;
    let mockRound: any;
    let mockOffice: any;

    beforeEach(async () => {
        // Clean db
        await prisma.auditLog.deleteMany({});
        await prisma.ballotVote.deleteMany({});
        await prisma.ballotReport.deleteMany({});
        await prisma.office.deleteMany({});
        await prisma.electionRound.deleteMany({});
        await prisma.election.deleteMany({});

        mockElection = await prisma.election.create({ data: { plei: "3220", name: "Test Ele", year: 2026, description: "", status: "ACTIVE" } });
        mockRound = await prisma.electionRound.create({ data: { electionId: mockElection.id, roundNumber: 1, status: "ACTIVE" } });
        mockOffice = await prisma.office.create({ data: { name: "Presidente", orderNumber: 1, configuration: "{}" } });
    });

    it("somente NEW é inserido com sucesso", async () => {
        const newReports = [{
            status: "NEW",
            deterministicId: "test-det-1",
            payload: {
                electionId: "3220", roundNumber: 1, stateCode: "BR", cityCode: "123", zoneCode: "1", sectionCode: "1", urnCode: "1", hash: "x", signature: "y",
                votes: [
                    { officeName: "Presidente", candidateNumber: "13", partyNumber: "13", voteType: "NOMINAL", quantity: 50 }
                ]
            }
        }];

        await executeApplyTransaction(prisma, newReports, mockElection, mockRound);

        const reports = await prisma.ballotReport.findMany();
        expect(reports).toHaveLength(1);
        expect(reports[0].deterministicId).toBe("test-det-1");
        expect(reports[0].status).toBe("PROCESSADO");
        expect(reports[0].metadata).toBe("IMPORT_DAT");

        const votes = await prisma.ballotVote.findMany();
        expect(votes).toHaveLength(1);
        expect(votes[0].quantity).toBe(50);
        
        const logs = await prisma.auditLog.findMany();
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe("BATCH_IMPORT_DAT");
    });

    it("item com status ALREADY_EXISTS é recusado e gera rollback completo", async () => {
        const fakeReports = [{
            status: "ALREADY_EXISTS",
            deterministicId: "test-det-exist",
            payload: {
                electionId: "3220", roundNumber: 1, stateCode: "BR", cityCode: "123", zoneCode: "1", sectionCode: "1", urnCode: "1", hash: "x", signature: "y",
                votes: []
            }
        }];

        await expect(executeApplyTransaction(prisma, fakeReports, mockElection, mockRound)).rejects.toThrow("APPLY_NON_NEW_RECORD_REFUSED");

        const reports = await prisma.ballotReport.findMany();
        expect(reports).toHaveLength(0);

        const votes = await prisma.ballotVote.findMany();
        expect(votes).toHaveLength(0);

        const logs = await prisma.auditLog.findMany();
        expect(logs).toHaveLength(0);
    });

    it("falha durante inserção causa rollback completo (falha ocorre APOS criar o BallotReport)", async () => {
        const newReports = [{
            status: "NEW",
            deterministicId: "test-det-2",
            payload: {
                electionId: "3220", roundNumber: 1, stateCode: "BR", cityCode: "123", zoneCode: "1", sectionCode: "1", urnCode: "1", hash: "x", signature: "y",
                votes: [
                    { officeName: "Cargo Inexistente", candidateNumber: "13", partyNumber: "13", voteType: "NOMINAL", quantity: 50 }
                ]
            }
        }];

        // The script throws MISSING_OFFICE which triggers rollback
        await expect(executeApplyTransaction(prisma, newReports, mockElection, mockRound)).rejects.toThrow("MISSING_OFFICE: Cargo Inexistente");

        const reports = await prisma.ballotReport.findMany();
        expect(reports).toHaveLength(0); // Rollback occurred!

        const votes = await prisma.ballotVote.findMany();
        expect(votes).toHaveLength(0); // Rollback occurred!

        const logs = await prisma.auditLog.findMany();
        expect(logs).toHaveLength(0); // Rollback occurred!
    });

    it("array vazio não executa transação e não insere logs (no-op puro)", async () => {
        const newReports: any[] = [];
        await executeApplyTransaction(prisma, newReports, mockElection, mockRound);

        const reports = await prisma.ballotReport.findMany();
        expect(reports).toHaveLength(0);

        const logs = await prisma.auditLog.findMany();
        expect(logs).toHaveLength(0); // MUST be 0!
    });
});


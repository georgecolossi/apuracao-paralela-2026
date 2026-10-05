
import { describe, it, expect } from "vitest";
import { validateApplyAuthorization, validateProductionPreconditions, prepareNewReportsForApply } from "../scripts/bu-dat/run_dry_run";
import * as path from "path";

describe("BU .dat Dry-Run --apply authorization", () => {
  const cwd = process.cwd();
  const rehearsalPath = path.resolve(cwd, "backups-local", "prod-apply-rehearsal-2026-10-05.db");
  const prodPath = path.resolve("/data/prod.db");

  it("A) rehearsal path exato -> REHEARSAL", () => {
    const mode = validateApplyAuthorization("file:" + rehearsalPath, undefined, undefined, ["--apply"]);
    expect(mode).toBe("REHEARSAL");
  });

  it("B) outro arquivo local -> REFUSED", () => {
    const dbUrl = "file:" + path.resolve(cwd, "test.db");
    expect(() => validateApplyAuthorization(dbUrl, undefined, undefined, ["--apply"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("C) /data/prod.db sem ALLOW_PRODUCTION_BU_IMPORT -> REFUSED", () => {
    const dbUrl = "file:" + prodPath;
    expect(() => validateApplyAuthorization(dbUrl, "false", undefined, ["--apply", "--confirm-production-import=3220-T1-2026-10-05"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("D) /data/prod.db com valor \"true\" -> REFUSED", () => {
    const dbUrl = "file:" + prodPath;
    expect(() => validateApplyAuthorization(dbUrl, "false", "true", ["--apply", "--confirm-production-import=3220-T1-2026-10-05"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("E) /data/prod.db com valor correto mas sem confirmação CLI -> REFUSED", () => {
    const dbUrl = "file:" + prodPath;
    expect(() => validateApplyAuthorization(dbUrl, "false", "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("F) confirmação CLI errada -> REFUSED", () => {
    const dbUrl = "file:" + prodPath;
    expect(() => validateApplyAuthorization(dbUrl, "false", "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply", "--confirm-production-import=other"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("G) ALLOW_OPERATIONAL_RESET diferente de string exata \"false\" -> REFUSED", () => {
    const dbUrl = "file:" + prodPath;
    expect(() => validateApplyAuthorization(dbUrl, "true", "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply", "--confirm-production-import=3220-T1-2026-10-05"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
    expect(() => validateApplyAuthorization(dbUrl, undefined, "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply", "--confirm-production-import=3220-T1-2026-10-05"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("H) todas as condições exatas -> PRODUCTION", () => {
    const dbUrl = "file:" + prodPath;
    const mode = validateApplyAuthorization(dbUrl, "false", "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply", "--confirm-production-import=3220-T1-2026-10-05"]);
    expect(mode).toBe("PRODUCTION");
  });

  it("I) caminho parecido: /data/prod.db.bak -> REFUSED", () => {
    const dbUrl = "file:" + prodPath + ".bak";
    expect(() => validateApplyAuthorization(dbUrl, "false", "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply", "--confirm-production-import=3220-T1-2026-10-05"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });

  it("J) caminho relativo/manipulado que não resolva exatamente para /data/prod.db -> REFUSED", () => {
    const fakePath = path.resolve("/data/fake/../prod2.db");
    const dbUrl = "file:" + fakePath;
    expect(() => validateApplyAuthorization(dbUrl, "false", "I_UNDERSTAND_THIS_WRITES_PRODUCTION", ["--apply", "--confirm-production-import=3220-T1-2026-10-05"])).toThrow("APPLY_REFUSED_UNSAFE_DATABASE");
  });
});

describe("BU .dat Dry-Run --apply production preconditions", () => {
  const getBaseReport = () => ({
    totalFiles: 193,
    decoded: 193,
    valid: 193,
    invalid: 0,
    alreadyExists: 31,
    new: 162,
    conflict: 0,
    duplicatesInDataset: 0,
    duplicateZonasSecaos: 0,
    results: [] as any[]
  });

  it("K) produção 31/162 -> preflight PASS", () => {
    const report = getBaseReport();
    const newReports = Array(162).fill({ status: "NEW" });
    expect(() => validateProductionPreconditions(report, newReports)).not.toThrow();
  });

  it("L) produção 193/0 -> ABORT_PRODUCTION_UNEXPECTED_COMPOSITION", () => {
    const report = getBaseReport();
    report.alreadyExists = 193;
    report.new = 0;
    const newReports: any[] = [];
    expect(() => validateProductionPreconditions(report, newReports)).toThrow("ABORT_PRODUCTION_UNEXPECTED_COMPOSITION");
  });

  it("M) produção 32/161 -> ABORT_PRODUCTION_UNEXPECTED_COMPOSITION", () => {
    const report = getBaseReport();
    report.alreadyExists = 32;
    report.new = 161;
    const newReports = Array(161).fill({ status: "NEW" });
    expect(() => validateProductionPreconditions(report, newReports)).toThrow("ABORT_PRODUCTION_UNEXPECTED_COMPOSITION");
  });

  it("N) produção com conflito > 0 -> ABORT", () => {
    const report = getBaseReport();
    report.conflict = 1;
    const newReports = Array(162).fill({ status: "NEW" });
    expect(() => validateProductionPreconditions(report, newReports)).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
  });

  it("O) produção com 161 payloads -> ABORT_PRODUCTION_NEW_COUNT", () => {
    const report = getBaseReport();
    const newReports = Array(161).fill({ status: "NEW" });
    expect(() => validateProductionPreconditions(report, newReports)).toThrow("ABORT_PRODUCTION_NEW_COUNT");
  });

  it("P) produção com payload inválido -> ABORT", () => {
    const report = getBaseReport();

    for (let i = 0; i < 161; i++) {
      report.results.push({
        status: "NEW",
        payload: {
          electionId: "3220",
          roundNumber: "1",
          stateCode: "SC",
          cityCode: "80837",
          zoneCode: "9",
          sectionCode: "169",
          urnCode: "1234",
          votes: []
        }
      });
    }

    report.results.push({
      status: "NEW",
      payload: {
        electionId: "3220",
        stateCode: "SC",
        cityCode: "80837",
        zoneCode: "9",
        sectionCode: "169",
        urnCode: "1234",
        votes: []
      }
    });

    expect(() => prepareNewReportsForApply(report)).toThrow("APPLY_INVALID_PAYLOAD_STRUCTURE");
  });
});

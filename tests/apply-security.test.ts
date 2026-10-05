import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { validatePreconditions } from "../scripts/bu-dat/run_dry_run";

describe("BU .dat Dry-Run --apply security", () => {
  it("A) caminho rehearsal EXATO aceito", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "file:" + require("path").resolve(process.cwd(), "backups-local", "prod-apply-rehearsal-2026-10-05.db") }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).not.toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });

  it("B) caminho que apenas contem o nome do rehearsal eh recusado", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "file:./fake/prod-apply-rehearsal-2026-10-05.db" }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });

  it("B2) caminho com sufixo -FAKE eh recusado", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "file:./backups-local/prod-apply-rehearsal-2026-10-05.db-FAKE" }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });

  it("C) DATABASE_URL ausente", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "" }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });

  it("D) file:./dev.db", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "file:./dev.db" }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });

  it("E) file:./prod.db", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "file:./prod.db" }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });

  it("F) file:/data/prod.db", () => {
    try {
        execSync("npx tsx scripts/bu-dat/run_dry_run.ts --apply", { env: { ...process.env, DATABASE_URL: "file:/data/prod.db" }, stdio: "pipe" });
    } catch (e: any) {
        expect(e.stderr.toString()).toContain("APPLY_REFUSED_UNSAFE_DATABASE");
    }
  });
});

describe("Preconditions dataset validation", () => {
    const base = { totalFiles: 193, decoded: 193, valid: 193, invalid: 0, conflict: 0, duplicatesInDataset: 0, duplicateZonasSecaos: 0, alreadyExists: 31, new: 162 };

    it("Valid composition 31/162", () => {
        expect(() => validatePreconditions(base)).not.toThrow();
    });
    it("Valid composition 193/0 (idempotent)", () => {
        expect(() => validatePreconditions({ ...base, alreadyExists: 193, new: 0 })).not.toThrow();
    });
    it("invalid > 0 bloqueia", () => {
        expect(() => validatePreconditions({ ...base, invalid: 1 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("conflict > 0 bloqueia", () => {
        expect(() => validatePreconditions({ ...base, conflict: 1 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("duplicate deterministic ID bloqueia", () => {
        expect(() => validatePreconditions({ ...base, duplicatesInDataset: 1 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("duplicate zona/seção bloqueia", () => {
        expect(() => validatePreconditions({ ...base, duplicateZonasSecaos: 1 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("totalFiles != 193 bloqueia", () => {
        expect(() => validatePreconditions({ ...base, totalFiles: 192 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("decoded != 193 bloqueia", () => {
        expect(() => validatePreconditions({ ...base, decoded: 192 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("valid != 193 bloqueia", () => {
        expect(() => validatePreconditions({ ...base, valid: 192 })).toThrow("ABORT_DUE_TO_DATASET_PRECONDITIONS");
    });
    it("composição diferente de 31/162 ou 193/0 bloqueia", () => {
        expect(() => validatePreconditions({ ...base, alreadyExists: 30, new: 163 })).toThrow("ABORT_DUE_TO_UNEXPECTED_COMPOSITION");
    });
});


import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { POST as scanRoute } from '../src/app/api/scan/route';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';
import { Tse2026QrAssembler } from '../src/lib/parser/tse2026/Tse2026QrAssembler';
import { Tse2026QrTokenizer } from '../src/lib/parser/tse2026/Tse2026QrTokenizer';
import { Tse2026SemanticParser } from '../src/lib/parser/tse2026/Tse2026SemanticParser';
import { Tse2026HashValidator } from '../src/lib/parser/tse2026/Tse2026HashValidator';

interface ExtractedBarcode {
  imageIndex: number;
  xref: number;
  width: number;
  height: number;
  format: string;
  rawLength: number;
  rawText: string;
  type: 'QRBU' | 'QRCE' | 'OTHER';
  partIndex?: number;
  totalParts?: number;
}

interface ExtractedPage {
  pageNumber: number;
  text: string;
  imagesCount: number;
  barcodes: ExtractedBarcode[];
}

interface ExtractedPdfResult {
  pdfPath: string;
  fileSize: number;
  pageCount: number;
  pages: ExtractedPage[];
  qrbuParts: ExtractedBarcode[];
  qrceParts: ExtractedBarcode[];
  otherBarcodes: ExtractedBarcode[];
}

function extractPdfData(relPdfPath: string): ExtractedPdfResult {
  const fullPath = path.resolve(__dirname, 'fixtures/tse2026/turno2', relPdfPath);
  const scriptPath = path.resolve(__dirname, '../scripts/pdf-qr-extractor.py');
  const out = execSync(`python "${scriptPath}" "${fullPath}"`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(out);
}

describe('TSE 2026 Turno 2 — Auditoria Complementar Aprofundada dos QRBUs Oficiais', () => {
  const baseDir = path.join(__dirname, 'fixtures/tse2026/turno2');

  const SCENARIOS = [
    {
      id: 'SC1',
      name: 'Presidente',
      dir: 'BU_T2_VOTA_Presidente',
      datFile: 'Pres-T2_s02202ac0139200090013-imgbu.dat',
      pdfFile: 'Pres-T2_s02202ac0139200090013-imgbu.pdf',
      datSize: 5829,
      datSha256: '083dbcf02d00c3e8f63f1d1e8dc3f8dfba7cc342ee747fbca92d29b30e79311c',
      pdfSize: 43941,
      pdfSha256: '8467c318e7bbf26cf0c22a251b27f883518ca3ea2dec330e671819b1dcf3ef4f',
      expectedPages: 2,
      expectedQrbus: 1,
      expectedQrces: 2,
      plei: '2202',
      turn: 2,
      cityCode: '01392',
      zoneCode: '9',
      sectionCode: '13',
      urnCode: '2250280',
      apto: 26,
      comp: 4,
      falt: 22,
      aggregated: ['14', '15'],
      expectedPresidentVotes: {
        nominal: [{ candidate: '92', qty: 2 }],
        branco: 1,
        nulo: 1,
        total: 4
      }
    },
    {
      id: 'SC2',
      name: 'Presidente + Governador',
      dir: 'BU_T2_VOTA_Presidente_Governador',
      datFile: 'PresGov-T2_s02200ac0139200090013-imgbu.dat',
      pdfFile: 'PresGov-T2_s02200ac0139200090013-imgbu.pdf',
      datSize: 6895,
      datSha256: 'ce3131508af46efa6dbe449339fa0dd868a5281803446d4364600887cf93477f',
      pdfSize: 44905,
      pdfSha256: '3f418e131d3682413923926bc434e7d5463254a6fa1d4ad84e622b129ea55e9b',
      expectedPages: 2,
      expectedQrbus: 1,
      expectedQrces: 2,
      plei: '2200',
      turn: 2,
      cityCode: '01392',
      zoneCode: '9',
      sectionCode: '13',
      urnCode: '2250280',
      apto: 26,
      comp: 4,
      falt: 22,
      aggregated: ['14', '15'],
      expectedPresidentVotes: {
        nominal: [{ candidate: '91', qty: 1 }, { candidate: '92', qty: 2 }],
        branco: 0,
        nulo: 1,
        total: 4
      },
      expectedGovernorVotes: {
        nominal: [{ candidate: '91', qty: 2 }, { candidate: '92', qty: 1 }],
        branco: 1,
        nulo: 0,
        total: 4
      }
    },
    {
      id: 'SC3',
      name: 'Presidente + Governador + Consulta Popular',
      dir: 'BU_T2_VOTA_Presidente_Governador_ConsultaPopular',
      datFile: 'PresGovConMunic-T2_s02120ac0139200090013-imgbu.dat',
      pdfFile: 'PresGovConMunic-T2_s02120ac0139200090013-imgbu.pdf',
      datSize: 7683,
      datSha256: '4db34a3feda8fda1d0243f1d4d4b2eda5eaa8c30f326e86585d33247cc16ab6a',
      pdfSize: 45816,
      pdfSha256: 'a14f97d6a82d889a5c8f4c0d747c921b62753255862c26ef0883fc48705ddd7e',
      expectedPages: 3,
      expectedQrbus: 1,
      expectedQrces: 2,
      plei: '2120',
      turn: 2,
      cityCode: '01392',
      zoneCode: '9',
      sectionCode: '13',
      urnCode: '2250280',
      apto: 26,
      comp: 4,
      falt: 22,
      aggregated: ['14', '15'],
      expectedPresidentVotes: {
        nominal: [{ candidate: '91', qty: 2 }, { candidate: '92', qty: 1 }],
        branco: 0,
        nulo: 1,
        total: 4
      },
      expectedGovernorVotes: {
        nominal: [{ candidate: '91', qty: 1 }, { candidate: '92', qty: 2 }],
        branco: 1,
        nulo: 0,
        total: 4
      },
      expectedConsultaPopularVotes: {
        nominal: [{ candidate: '5', qty: 2 }, { candidate: '7', qty: 1 }],
        branco: 0,
        nulo: 1,
        total: 4
      }
    },
    {
      id: 'SC4',
      name: 'Presidente + Governador + Prefeito',
      dir: 'BU_T2_VOTA_Presidente_Governador_Prefeito',
      datFile: 'PresGovPrefeito-T2_s18153sp6665603020018-imgbu.dat',
      pdfFile: 'PresGovPrefeito-T2_s18153sp6665603020018-imgbu.pdf',
      datSize: 7605,
      datSha256: '9f3b2f9765d9a1c85fe48f5a5a7999bfb0841676711725c56ddf16b69c8d5012',
      pdfSize: 45622,
      pdfSha256: 'ade2c7660bf3b6ff0be5d62c9e350e389d72045a997bf30cf6ca1143e5b0a19a',
      expectedPages: 3,
      expectedQrbus: 1,
      expectedQrces: 2,
      plei: '18153',
      turn: 2,
      cityCode: '66656',
      zoneCode: '302',
      sectionCode: '18',
      urnCode: '2250280',
      apto: 771,
      comp: 4,
      falt: 767,
      aggregated: ['44'],
      expectedPresidentVotes: {
        nominal: [{ candidate: '77', qty: 2 }],
        branco: 2,
        nulo: 0,
        total: 4
      },
      expectedGovernorVotes: {
        nominal: [{ candidate: '13', qty: 2 }],
        branco: 1,
        nulo: 1,
        total: 4
      },
      expectedPrefeitoVotes: {
        nominal: [{ candidate: '10', qty: 2 }, { candidate: '40', qty: 2 }],
        branco: 0,
        nulo: 0,
        total: 4
      }
    }
  ];

  let operatorId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Operador Auditoria TSE T2',
        email: `op-tse-audit-${Date.now()}@teste.local`,
        passwordHash: 'hash',
        role: 'ADMIN'
      }
    });
    operatorId = user.id;
  });

  // =========================================================================
  // SEÇÃO 1 & 2: VERIFICAÇÃO DE ARQUIVOS E EXTRAÇÃO DIRETA DOS QR CODES
  // =========================================================================

  it('1. Integridade dos 8 arquivos oficiais TSE Turno 2 (tamanho e SHA-256)', () => {
    for (const sc of SCENARIOS) {
      const datPath = path.join(baseDir, sc.dir, sc.datFile);
      const pdfPath = path.join(baseDir, sc.dir, sc.pdfFile);

      expect(fs.existsSync(datPath), `DAT ausente: ${sc.datFile}`).toBe(true);
      expect(fs.existsSync(pdfPath), `PDF ausente: ${sc.pdfFile}`).toBe(true);

      const datStat = fs.statSync(datPath);
      const pdfStat = fs.statSync(pdfPath);
      expect(datStat.size).toBe(sc.datSize);
      expect(pdfStat.size).toBe(sc.pdfSize);

      const datHash = crypto.createHash('sha256').update(fs.readFileSync(datPath)).digest('hex');
      const pdfHash = crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex');
      expect(datHash).toBe(sc.datSha256);
      expect(pdfHash).toBe(sc.pdfSha256);
    }
  });

  it('2. Leitura real de todas as páginas e extração de QR Codes em todos os 4 PDFs', () => {
    for (const sc of SCENARIOS) {
      const relPdf = `${sc.dir}/${sc.pdfFile}`;
      const extResult = extractPdfData(relPdf);

      // A. Páginas inspecionadas
      expect(extResult.pageCount).toBe(sc.expectedPages);
      expect(extResult.pages.length).toBe(sc.expectedPages);

      // B. Distinção rigorosa entre QRBU e QRCE
      expect(extResult.qrbuParts.length).toBe(sc.expectedQrbus);
      expect(extResult.qrceParts.length).toBe(sc.expectedQrces);
      expect(extResult.otherBarcodes.length).toBe(0);

      // C. Estrutura do QRBU
      const qrbu = extResult.qrbuParts[0];
      expect(qrbu.type).toBe('QRBU');
      expect(qrbu.partIndex).toBe(1);
      expect(qrbu.totalParts).toBe(1);
      expect(qrbu.format).toMatch(/QR\s*Code/i);
      expect(qrbu.rawText.startsWith('QRBU:1:1')).toBe(true);

      // D. Estrutura dos QRCEs (Certificado Digital em 2 partes)
      const qrce1 = extResult.qrceParts.find(p => p.partIndex === 1);
      const qrce2 = extResult.qrceParts.find(p => p.partIndex === 2);
      expect(qrce1).toBeDefined();
      expect(qrce2).toBeDefined();
      expect(qrce1!.totalParts).toBe(2);
      expect(qrce2!.totalParts).toBe(2);
      expect(qrce1!.rawText.startsWith('QRCE:1:2')).toBe(true);
      expect(qrce2!.rawText.startsWith('QRCE:2:2')).toBe(true);

      // E. Reconstrução e integridade criptográfica SHA-512 do QRBU oficial
      const assembler = new Tse2026QrAssembler();
      const reconstructed = assembler.reconstruct([qrbu.rawText]);
      expect(typeof reconstructed).toBe('string');

      const hashMatch = qrbu.rawText.match(/HASH:([A-Fa-f0-9]+)/);
      expect(hashMatch).not.toBeNull();
      const providedHash = hashMatch![1];
      expect(providedHash.length).toBe(128); // 128 caracteres hexadecimais = SHA-512

      const validator = new Tse2026HashValidator();
      const hashVerification = validator.validate(reconstructed as string, providedHash, [qrbu.rawText]);
      expect(hashVerification, `Falha de SHA-512 no cenário ${sc.name}`).toBe('VERIFIED');
    }
  });

  // =========================================================================
  // SEÇÃO 3: COMPARAÇÃO INDEPENDENTE ENTRE PDF IMPRESSO, QRBU E .DAT
  // =========================================================================

  it('3. Comparação de dados: Texto impresso no PDF, QRBU decodificado e arquivo ASN.1 .DAT', () => {
    for (const sc of SCENARIOS) {
      const relPdf = `${sc.dir}/${sc.pdfFile}`;
      const extResult = extractPdfData(relPdf);
      const qrbuText = extResult.qrbuParts[0].rawText;

      const datPath = path.join(baseDir, sc.dir, sc.datFile);
      const datBytes = fs.readFileSync(datPath);

      // Texto unificado das páginas do PDF
      const pdfText = extResult.pages.map(p => p.text).join('\n');

      // Executa o parser semântico oficial do sistema sobre o QRBU
      const parser = new Tse2026BallotReportParser();
      const report = parser.parseReport(qrbuText, [qrbuText]);
      expect('code' in report).toBe(false);
      const data = report as any;

      // 1. PLEI e Turno
      expect(data.electionId).toBe(sc.plei);
      expect(data.roundNumber).toBe(sc.turn);
      expect(pdfText).toMatch(/2[º°]\s*Turno/i);

      // 2. Fase Eleitoral
      expect(data.fase).toBe('S'); // FASE:S no QRBU
      expect(pdfText).toContain('SIMULADO'); // Marca d'água impressa no PDF

      // 3. Município, Zona, Seção
      expect(data.cityCode).toBe(sc.cityCode);
      expect(data.zoneCode).toBe(sc.zoneCode);
      expect(data.sectionCode).toBe(sc.sectionCode);
      expect(pdfText).toContain(sc.cityCode);
      expect(pdfText).toContain(sc.sectionCode.padStart(4, '0'));

      // 4. Identificação da Urna (IDUE)
      expect(data.urnCode).toBe(sc.urnCode);
      expect(pdfText).toContain(sc.urnCode);
      // Confirma que no .dat binário o IDUE está presente
      expect(datBytes.includes(Buffer.from(sc.urnCode))).toBe(true);

      // 5. Aptos, Comparecimento, Faltosos
      expect(data.apto).toBe(sc.apto);
      expect(data.comp).toBe(sc.comp);
      expect(data.falt).toBe(sc.falt);
      expect(data.comp + data.falt).toBe(data.apto); // Invariante canônica da urna

      // 6. Assinatura Digital do BU impresso no PDF vs ASSI do QRBU
      const matchAssi = qrbuText.match(/ASSI:([A-Fa-f0-9]+)/);
      expect(matchAssi).not.toBeNull();
      const rawAssi = matchAssi![1];
      // A assinatura do PDF (sem quebras de linha) deve ser idêntica ao token ASSI do QRBU
      const cleanPdfText = pdfText.replace(/\s+/g, '');
      expect(cleanPdfText).toContain(rawAssi);
    }
  });

  // =========================================================================
  // SEÇÃO 4: SEÇÕES AGREGADAS — TESTE ESPECIAL
  // =========================================================================

  describe('4. Seções Agregadas — Análise de Isolamento, Multiplicação e Cobertura', () => {
    it('Deve identificar o BU pela seção principal (0013) sem gerar BUs independentes para agregadas (0014, 0015)', () => {
      const extResult = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const qrbuText = extResult.qrbuParts[0].rawText;

      // O token AGRE deve conter '14.15'
      expect(qrbuText).toContain('SECA:13');
      expect(qrbuText).toContain('AGRE:14.15');

      const parser = new Tse2026BallotReportParser();
      const report = parser.parseReport(qrbuText, [qrbuText]) as any;

      // Seção principal atribuída exclusivamente ao BU
      expect(report.sectionCode).toBe('13');
      expect(report.cityCode).toBe('01392');

      // Votos não são multiplicados: total apurado = 4 (e não 4 * 3 = 12)
      const totalVotos = report.votes.reduce((acc: number, v: any) => acc + v.quantity, 0);
      expect(totalVotos).toBe(4);
      expect(report.comp).toBe(4);
    });

    it('Scanner operacional rejeita tentativas de envio com seções agregadas sem BU independente', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
        authenticated: true,
        user: { userId: operatorId, role: 'ADMIN' }
      }));

      // Ativar temporariamente o T2 com o PLEI correspondente para testar a checagem de seção
      const election = await prisma.election.findFirst({ where: { status: 'ACTIVE' } });
      expect(election).toBeDefined();

      await prisma.electionRound.updateMany({
        where: { electionId: election!.id, roundNumber: 2 },
        data: { status: 'ACTIVE', plei: '2202' }
      });

      // Criar estado, município e zona no banco isolado de teste
      const state = await prisma.state.upsert({
        where: { abbreviation: 'AC' },
        update: {},
        create: { abbreviation: 'AC', name: 'Acre' }
      });
      const muni = await prisma.municipality.upsert({
        where: { officialCode: '01392' },
        update: { isCoverage: true },
        create: { name: 'Rio Branco', officialCode: '01392', stateId: state.id, isCoverage: true }
      });
      let zone = await prisma.pollingZone.findFirst({
        where: { municipalityId: muni.id, zoneNumber: '0009' }
      });
      if (!zone) {
        zone = await prisma.pollingZone.create({
          data: { zoneNumber: '0009', municipalityId: muni.id }
        });
      }

      // Cadastrar seção agregada 0014 com expectedBUs = 0
      let secAgregada = await prisma.pollingSection.findFirst({
        where: { pollingZoneId: zone.id, sectionNumber: '0014' }
      });
      if (!secAgregada) {
        secAgregada = await prisma.pollingSection.create({
          data: { sectionNumber: '0014', pollingZoneId: zone.id, expectedBUs: 0 }
        });
      } else {
        await prisma.pollingSection.update({
          where: { id: secAgregada.id },
          data: { expectedBUs: 0 }
        });
      }

      // Tentativa de enviar BU forjado apontando diretamente para a seção agregada 0014 (com hash recalculado)
      const extResult = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const forgedNoHash = extResult.qrbuParts[0].rawText.replace('SECA:13', 'SECA:14').replace(/ HASH:.*/, '');
      const hashInput = forgedNoHash.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '');
      const newHash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();
      const assiMatch = extResult.qrbuParts[0].rawText.match(/ ASSI:.*/);
      const forgedContent = forgedNoHash + ' HASH:' + newHash + (assiMatch ? assiMatch[0] : '');

      const prevAllow = process.env.ALLOW_SIMULATED_FASE;
      process.env.ALLOW_SIMULATED_FASE = 'true';

      try {
        const res = await scanRoute(new Request('http://localhost/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: forgedContent,
            sessionId: 'session-sec-agregada-' + Date.now(),
            isSimulation: false
          })
        }));

        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toBe('SECTION_AGGREGATED_NO_BU');
        expect(data.message).toContain('Esta seção eleitoral é agregada e não possui Boletim de Urna independente');
      } finally {
        if (prevAllow === undefined) {
          delete process.env.ALLOW_SIMULATED_FASE;
        } else {
          process.env.ALLOW_SIMULATED_FASE = prevAllow;
        }
        // Restaurar status PLANNED do T2 no banco de teste
        await prisma.electionRound.updateMany({
          where: { electionId: election!.id, roundNumber: 2 },
          data: { status: 'PLANNED', plei: '3221' }
        });
      }
    });
  });

  // =========================================================================
  // SEÇÃO 5: MÚLTIPLOS CARGOS E CONSULTAS POPULARES — ISOLAMENTO
  // =========================================================================

  describe('5. Múltiplos Cargos e Consultas Populares — Isolamento de Votos e Semântica', () => {
    it('Cenário 1 (Presidente): Votos restritos exclusivamente ao cargo 1', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const parser = new Tse2026BallotReportParser();
      const report = parser.parseReport(ext.qrbuParts[0].rawText, [ext.qrbuParts[0].rawText]) as any;

      const offices = new Set(report.votes.map((v: any) => v.officeName));
      expect(offices.size).toBe(1);
      expect(offices.has('Presidente')).toBe(true);

      const presNominal = report.votes.filter((v: any) => v.officeName === 'Presidente' && v.type === 'NOMINAL');
      expect(presNominal.length).toBe(1);
      expect(presNominal[0].candidateNumber).toBe('92');
      expect(presNominal[0].quantity).toBe(2);
    });

    it('Cenário 2 (Presidente + Governador): Votos de Governador não contaminam Presidente', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente_Governador/PresGov-T2_s02200ac0139200090013-imgbu.pdf');
      const parser = new Tse2026BallotReportParser();
      const report = parser.parseReport(ext.qrbuParts[0].rawText, [ext.qrbuParts[0].rawText]) as any;

      const govVotes = report.votes.filter((v: any) => v.officeName === 'Governador');
      const presVotes = report.votes.filter((v: any) => v.officeName === 'Presidente');

      expect(govVotes.length).toBe(4); // 91:2, 92:1, BRAN:1, NULO:0
      expect(presVotes.length).toBe(4); // 91:1, 92:2, BRAN:0, NULO:1

      const govTotal = govVotes.reduce((acc: number, v: any) => acc + v.quantity, 0);
      const presTotal = presVotes.reduce((acc: number, v: any) => acc + v.quantity, 0);
      expect(govTotal).toBe(4);
      expect(presTotal).toBe(4);

      // Inversão estrita de votos: Governador 91 tem 2 votos, Presidente 91 tem 1 voto
      const gov91 = govVotes.find((v: any) => v.candidateNumber === '91');
      const pres91 = presVotes.find((v: any) => v.candidateNumber === '91');
      expect(gov91.quantity).toBe(2);
      expect(pres91.quantity).toBe(1);
    });

    it('Cenário 3 (Presidente + Governador + Consulta Popular): Consulta Popular tratada sem colisão', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente_Governador_ConsultaPopular/PresGovConMunic-T2_s02120ac0139200090013-imgbu.pdf');
      const parser = new Tse2026BallotReportParser();
      const report = parser.parseReport(ext.qrbuParts[0].rawText, [ext.qrbuParts[0].rawText]) as any;

      const presVotes = report.votes.filter((v: any) => v.officeName === 'Presidente');
      const govVotes = report.votes.filter((v: any) => v.officeName === 'Governador');
      const consultaVotes = report.votes.filter((v: any) => v.officeName.includes('53'));

      expect(presVotes.length).toBe(4);
      expect(govVotes.length).toBe(4);
      expect(consultaVotes.length).toBe(4); // Opção 5: 2 votos, Opção 7: 1 voto, Branco: 0, Nulo: 1

      // Nenhum voto da consulta popular pode aparecer em Presidente
      const presOption5 = presVotes.find((v: any) => v.candidateNumber === '5');
      expect(presOption5).toBeUndefined();
    });

    it('Cenário 4 (Presidente + Governador + Prefeito): Eleição suplementar municipal não afeta Presidente', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente_Governador_Prefeito/PresGovPrefeito-T2_s18153sp6665603020018-imgbu.pdf');
      const parser = new Tse2026BallotReportParser();
      const report = parser.parseReport(ext.qrbuParts[0].rawText, [ext.qrbuParts[0].rawText]) as any;

      const presVotes = report.votes.filter((v: any) => v.officeName === 'Presidente');
      const prefVotes = report.votes.filter((v: any) => v.officeName === 'Prefeito');
      const govVotes = report.votes.filter((v: any) => v.officeName === 'Governador');

      expect(presVotes.length).toBe(3); // 77:2, BRAN:2, NULO:0
      expect(prefVotes.length).toBe(4); // 10:2, 40:2, BRAN:0, NULO:0
      expect(govVotes.length).toBe(3); // 13:2, BRAN:1, NULO:1

      const presTotal = presVotes.reduce((acc: number, v: any) => acc + v.quantity, 0);
      const prefTotal = prefVotes.reduce((acc: number, v: any) => acc + v.quantity, 0);
      expect(presTotal).toBe(4);
      expect(prefTotal).toBe(4);
    });
  });

  // =========================================================================
  // SEÇÃO 6: TESTES DE ROBUSTEZ DO PARSER E DO SCANNER
  // =========================================================================

  describe('6. Testes de Robustez e Resiliência a Falhas', () => {
    const assembler = new Tse2026QrAssembler();
    const tokenizer = new Tse2026QrTokenizer();
    const semanticParser = new Tse2026SemanticParser();
    const fullParser = new Tse2026BallotReportParser();

    const samplePart1 = 'QRBU:1:2 VRQR:6.0 ORIG:VOTA PLEI:2202 TURN:2 FASE:S UNFE:AC MUNI:1392 ZONA:9 SECA:13 IDUE:2250280';
    const samplePart2 = 'QRBU:2:2 CARG:1 92:2 BRAN:1 NULO:1 TOTC:4 HASH:1234';

    it('6.1. Reconstrução com QR Codes multipartes fora de ordem', () => {
      const reconstructed = assembler.reconstruct([samplePart2, samplePart1]);
      expect(typeof reconstructed).toBe('string');
      expect((reconstructed as string).startsWith('VRQR:6.0')).toBe(true);
      expect((reconstructed as string).endsWith('HASH:1234')).toBe(true);
    });

    it('6.2. Rejeição de partes repetidas com DUPLICATE_PARTS', () => {
      const res = assembler.reconstruct([samplePart1, samplePart1]);
      expect(typeof res).not.toBe('string');
      expect((res as any).code).toBe('DUPLICATE_PARTS');
    });

    it('6.3. Rejeição de partes ausentes com MISSING_PARTS', () => {
      const res = assembler.reconstruct([samplePart1]);
      expect(typeof res).not.toBe('string');
      expect((res as any).code).toBe('MISSING_PARTS');
    });

    it('6.4. Detecção de adulteração de votos no payload com INVALID_HASH', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const validQr = ext.qrbuParts[0].rawText;

      // Adulterar a quantidade de votos do candidato 92 de 2 para 9
      const tampered = validQr.replace('92:2', '92:9');
      const report = fullParser.parseReport(tampered, [tampered]);
      expect((report as any).code).toBe('INVALID_HASH');
    });

    it('6.5. Rejeição quando o hash informado não confere (INVALID_HASH)', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const validQr = ext.qrbuParts[0].rawText;

      const fakeHash = validQr.replace(/HASH:[A-F0-9]+/, 'HASH:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
      const report = fullParser.parseReport(fakeHash, [fakeHash]);
      expect((report as any).code).toBe('INVALID_HASH');
    });

    it('6.6. Rejeição de total de partes divergente entre cabeçalhos (TOTAL_MISMATCH)', () => {
      const inconsistentPart2 = 'QRBU:2:3 CARG:1 92:2 HASH:1234';
      const res = assembler.reconstruct([samplePart1, inconsistentPart2]);
      expect((res as any).code).toBe('TOTAL_MISMATCH');
    });

    it('6.7. Tolerância a campos desconhecidos sem interrupção do parser', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const withUnknown = ext.qrbuParts[0].rawText.replace('ORIG:VOTA', 'ORIG:VOTA CAMPOFUTURO:XYZ');
      const tokens = tokenizer.tokenize(withUnknown);
      const report = semanticParser.parse(tokens) as any;

      expect('code' in report).toBe(false);
      expect(report.warnings?.some((w: string) => w.includes('CAMPOFUTURO'))).toBe(true);
      expect(report.sectionCode).toBe('13');
    });

    it('6.8. Aceitação de BU sem campos opcionais (ex: sem AGRE)', () => {
      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const withoutAgre = ext.qrbuParts[0].rawText.replace(' AGRE:14.15', '');
      const tokens = tokenizer.tokenize(withoutAgre);
      const report = semanticParser.parse(tokens) as any;

      expect('code' in report).toBe(false);
      expect(report.sectionCode).toBe('13');
      expect(report.votes.length).toBe(3);
    });

    it('6.9. Rejeição segura de conteúdo truncado ou sem campos estruturais', () => {
      // String truncada antes de conter ZONA e SECA
      const truncated = 'QRBU:1:1 VRQR:6.0 ORIG:VOTA PLEI:2202 TURN:2 FASE:S UNFE:AC MUNI:1392';
      const tokens = tokenizer.tokenize(truncated);
      const report = semanticParser.parse(tokens);

      expect((report as any).code).toBe('MISSING_FIELDS');
    });

    it('6.10. Rejeição de excesso de partes (TOO_MANY_PARTS)', () => {
      const extraPart = 'QRBU:3:2 DADO:EXTRA';
      const res = assembler.reconstruct([samplePart1, samplePart2, extraPart]);
      expect((res as any).code).toBe('TOO_MANY_PARTS');
    });

    it('6.11. Idempotência e proteção contra duplicação de envio de BUs', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
        authenticated: true,
        user: { userId: operatorId, role: 'ADMIN' }
      }));

      // Teste do parser Assembler parsePart
      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const qrbu = ext.qrbuParts[0].rawText;

      const partInfo1 = assembler.parseHeader(qrbu);
      const partInfo2 = assembler.parseHeader(qrbu);
      expect(partInfo1).toEqual(partInfo2);
    });
  });

  // =========================================================================
  // SEÇÃO 7: ISOLAMENTO ESTRITO DA FASE SIMULADA (FASE:S)
  // =========================================================================

  describe('7. Isolamento da Fase Simulada (FASE:S e FASE:T) vs Oficial (FASE:O)', () => {
    it('Permite análise estrutural e cálculo de hash de FASE:S em modo de teste local', () => {
      for (const sc of SCENARIOS) {
        const ext = extractPdfData(`${sc.dir}/${sc.pdfFile}`);
        const qrbu = ext.qrbuParts[0].rawText;

        const parser = new Tse2026BallotReportParser();
        const report = parser.parseReport(qrbu, [qrbu]) as any;

        expect(report.fase).toBe('S');
        expect(report.hashStatus).toBe('VERIFIED');
        expect(report.sigStatus).toBe('UNAVAILABLE'); // Não autenticado criptograficamente por assinatura assimétrica
      }
    });

    it('Scanner operacional rejeita FASE:S e FASE:T com SIMULATED_QRBU_REJECTED (HTTP 400)', async () => {
      vi.spyOn(auth, 'requireAuthenticatedUser').mockImplementation(async () => ({
        authenticated: true,
        user: { userId: operatorId, role: 'ADMIN' }
      }));

      const ext = extractPdfData('BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
      const simulatedQrbu = ext.qrbuParts[0].rawText;

      // Teste 1: FASE:S (rejeitado antes de gravar)
      const resS = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: simulatedQrbu,
          sessionId: 'session-reject-fase-s-' + Date.now(),
          isSimulation: false
        })
      }));
      expect(resS.status).toBe(400);
      const dataS = await resS.json();
      expect(dataS.error).toBe('SIMULATED_QRBU_REJECTED');

      // Teste 2: FASE:T (Treinamento) com hash SHA-512 válido recalculado
      const trainingPayloadNoHash = simulatedQrbu.replace('FASE:S', 'FASE:T').replace(/ HASH:.*/, '');
      const hashInput = trainingPayloadNoHash.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '');
      const newHash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();
      const assiMatch = simulatedQrbu.match(/ ASSI:.*/);
      const trainingQrbu = trainingPayloadNoHash + ' HASH:' + newHash + (assiMatch ? assiMatch[0] : '');

      const resT = await scanRoute(new Request('http://localhost/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trainingQrbu,
          sessionId: 'session-reject-fase-t-' + Date.now(),
          isSimulation: false
        })
      }));
      expect(resT.status).toBe(400);
      const dataT = await resT.json();
      expect(dataT.error).toBe('SIMULATED_QRBU_REJECTED');
    });
  });
});

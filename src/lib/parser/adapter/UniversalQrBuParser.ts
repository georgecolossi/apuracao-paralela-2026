/**
 * APURAÇÃO PARALELA 2.0 — DISPACHER E REGISTRO UNIVERSAL DE QRBU
 * 
 * Identifica determinística e estritamente a versão e o formato do QR Code,
 * despachando para o adaptador correspondente sem inferências silenciosas.
 */

import {
  QrBuAdapter,
  QrPartInfo,
  ParseError,
  BallotReportData
} from './QrBuAdapter';
import { Vrqr6Adapter } from './Vrqr6Adapter';
import { Vrqr5Adapter } from './Vrqr5Adapter';
import { Vrqr4Adapter } from './Vrqr4Adapter';
import { Tse2026SimulationParser } from '../Tse2026SimulationParser';

export class UniversalQrBuParser implements QrBuAdapter {
  readonly version = 'UNIVERSAL';
  readonly supportedFormats = ['6.0', '5.0', '4.0', '06.00', '05.00', '04.00', '01.01', '1.0', '01.00'];
  readonly description = 'Adaptador e despachante universal multi-formato para Boletins de Urna';

  private adapters: QrBuAdapter[];
  private simulationParser: Tse2026SimulationParser;

  constructor() {
    this.adapters = [
      new Vrqr6Adapter(),
      new Vrqr5Adapter(),
      new Vrqr4Adapter()
    ];
    this.simulationParser = new Tse2026SimulationParser();
  }

  /**
   * Retorna os formatos oficialmente comprovados e suportados pelo sistema.
   */
  getSupportedVersions(): string[] {
    return ['VRQR:6.0', 'VRQR:5.0', 'VRQR:4.0'];
  }

  /**
   * Retorna os formatos pendentes de homologação documental oficial ou sem fixtures reais disponíveis.
   */
  getPendingVersions(): Array<{ version: string; status: string; reason: string }> {
    return [
      {
        version: 'VRQR:3.0',
        status: 'PENDENTE',
        reason: 'Formato utilizado em eleições de 2018; aguardando pacote oficial de fixtures TSE.'
      },
      {
        version: 'VRQR:2.0',
        status: 'PENDENTE',
        reason: 'Formato legado de 2016; sem especificação técnica pública de hash multipartes.'
      },
      {
        version: 'VRQR:1.0',
        status: 'PENDENTE',
        reason: 'Primeira iteração experimental (2014); sem suporte planejado.'
      },
      {
        version: 'FORMATO_ASN1_BINARIO',
        status: 'PENDENTE',
        reason: 'Utilizado nos arquivos de log/rdv internos, não no QR Code impresso no Boletim de Urna.'
      }
    ];
  }

  /**
   * Resolve o adaptador apropriado de forma rigorosa, sem inferência silenciosa.
   */
  resolveAdapter(content: string): QrBuAdapter | ParseError {
    if (!content || typeof content !== 'string') {
      return { code: 'INVALID_HEADER', message: 'Conteúdo do QRBU ausente ou vazio.' };
    }

    const trimmed = content.trim();

    // 1. Simulação explícita
    if (trimmed.startsWith('SIMULATION|')) {
      return {
        version: 'SIMULATION',
        supportedFormats: ['SIMULATION'],
        description: 'Adaptador de Simulação para Testes e Demonstrações',
        canHandle: () => true,
        parsePart: (c: string): QrPartInfo | ParseError => {
          const res = this.simulationParser.parsePart(c);
          if ('code' in res && typeof res.code === 'string') {
            return { code: res.code, message: (res as { message?: string }).message || 'Erro em simulação' };
          }
          const valid = res as { partIndex: number; totalParts: number; sequenceId: string; payload: string };
          return {
            partIndex: valid.partIndex,
            totalParts: valid.totalParts,
            vrqrVersion: 'SIMULATION',
            sequenceId: valid.sequenceId,
            payload: valid.payload,
            rawContent: c
          };
        },
        reconstruct: (parts: string[]): string | ParseError => this.simulationParser.reconstruct(parts),
        parseReport: (full: string, raw?: string[]): BallotReportData | ParseError => {
          const res = this.simulationParser.parseReport(full, raw);
          if ('code' in res) return res;
          return res as BallotReportData;
        }
      };
    }

    // 2. Extração explícita da chave VRQR
    const vrqrMatch = trimmed.match(/VRQR:(\S+)/);
    if (!vrqrMatch) {
      return {
        code: 'INVALID_HEADER',
        message: 'Cabeçalho do Boletim de Urna não contém a identificação de versão de formato obrigatória (VRQR).'
      };
    }

    const detectedVersion = vrqrMatch[1];

    for (const adapter of this.adapters) {
      if (adapter.canHandle(trimmed)) {
        return adapter;
      }
    }

    // Rejeição determinística e explícita para versões desconhecidas ou pendentes (Fail-Closed)
    return {
      code: 'UNSUPPORTED_VRQR_VERSION',
      message: `A versão do formato QRBU 'VRQR:${detectedVersion}' não é suportada por esta versão da Apuração Paralela.`,
      details: {
        detectedVersion: `VRQR:${detectedVersion}`,
        supportedVersions: this.getSupportedVersions()
      }
    };
  }

  canHandle(content: string): boolean {
    const adapter = this.resolveAdapter(content);
    return !('code' in adapter);
  }

  parsePart(content: string): QrPartInfo | ParseError {
    const adapterOrError = this.resolveAdapter(content);
    if ('code' in adapterOrError) {
      return adapterOrError;
    }
    return adapterOrError.parsePart(content);
  }

  reconstruct(parts: string[]): string | ParseError {
    if (!parts || parts.length === 0) {
      return { code: 'NO_PARTS', message: 'Nenhuma parte enviada para reconstrução.' };
    }

    // Valida se todas as partes que informam VRQR possuem a mesma versão
    const versions = parts
      .map(p => {
        const m = p.match(/VRQR:(\S+)/);
        return m ? m[1] : null;
      })
      .filter((v): v is string => Boolean(v));

    if (versions.length > 0) {
      const firstVer = versions[0];
      if (versions.some(v => v !== firstVer)) {
        return { code: 'TOTAL_MISMATCH', message: 'As partes informam versões de formato QRBU divergentes.' };
      }
    }

    let adapterOrError: QrBuAdapter | ParseError = { code: 'INVALID_HEADER', message: 'Nenhuma parte contém cabeçalho de formato reconhecível.' };
    for (const part of parts) {
      const candidate = this.resolveAdapter(part);
      if (!('code' in candidate)) {
        adapterOrError = candidate;
        break;
      }
    }

    if ('code' in adapterOrError) {
      return adapterOrError;
    }
    return adapterOrError.reconstruct(parts);
  }

  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError {
    let adapterOrError: QrBuAdapter | ParseError = this.resolveAdapter(fullPayload);
    if ('code' in adapterOrError && rawParts && rawParts.length > 0) {
      for (const part of rawParts) {
        const candidate = this.resolveAdapter(part);
        if (!('code' in candidate)) {
          adapterOrError = candidate;
          break;
        }
      }
    }
    if ('code' in adapterOrError) {
      return adapterOrError;
    }
    return adapterOrError.parseReport(fullPayload, rawParts);
  }
}

import { BallotReportParser, BallotReportData, ParseError } from './index';
import { UniversalQrBuParser } from './adapter/UniversalQrBuParser';

/**
 * Adaptador universal para Boletins de Urna (QRBU).
 * Mantém compatibilidade integral com a interface histórica Tse2026BallotReportParser,
 * delegando determinística e estritamente para o despachante universal multi-formato.
 */
export class Tse2026BallotReportParser implements BallotReportParser {
  private universalParser = new UniversalQrBuParser();

  parsePart(content: string) {
    return this.universalParser.parsePart(content);
  }

  reconstruct(parts: string[]) {
    return this.universalParser.reconstruct(parts);
  }

  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError {
    return this.universalParser.parseReport(fullPayload, rawParts);
  }
}

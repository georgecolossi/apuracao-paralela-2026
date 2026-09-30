import { BallotReportParser, BallotReportData, ParseError } from './index';
import { Tse2026QrAssembler } from './tse2026/Tse2026QrAssembler';
import { Tse2026QrTokenizer } from './tse2026/Tse2026QrTokenizer';
import { Tse2026SemanticParser } from './tse2026/Tse2026SemanticParser';
import { Tse2026HashValidator } from './tse2026/Tse2026HashValidator';
import { Tse2026SignatureValidator } from './tse2026/Tse2026SignatureValidator';

export class Tse2026BallotReportParser implements BallotReportParser {
  private assembler = new Tse2026QrAssembler();
  private tokenizer = new Tse2026QrTokenizer();
  private semanticParser = new Tse2026SemanticParser();
  private hashValidator = new Tse2026HashValidator();
  private sigValidator = new Tse2026SignatureValidator();

  parsePart(content: string) {
    const infoOrError = this.assembler.parseHeader(content);
    if ('code' in infoOrError) return infoOrError;
    return infoOrError;
  }

  reconstruct(parts: string[]) {
    return this.assembler.reconstruct(parts);
  }

  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError {
    const tokens = this.tokenizer.tokenize(fullPayload);
    const reportDataOrError = this.semanticParser.parse(tokens);
    
    if ('code' in reportDataOrError) return reportDataOrError;

    // Validators
    const hashStatus = this.hashValidator.validate(fullPayload, reportDataOrError.hash || '', rawParts);
    const sigStatus = this.sigValidator.validate(fullPayload, reportDataOrError.signature, '');

    if (hashStatus === 'INVALID') {
      return { code: 'INVALID_HASH', message: 'O hash criptográfico não confere com o conteúdo do QR' };
    }

    reportDataOrError.hashStatus = hashStatus;
    reportDataOrError.sigStatus = sigStatus;

    return reportDataOrError;
  }
}

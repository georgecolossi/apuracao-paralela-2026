import { BallotReportParser, BallotReportData, ParseError } from './index';

export class Tse2026SimulationParser implements BallotReportParser {
  parsePart(content: string) {
    if (!content.startsWith('SIMULATION|')) {
      return { code: 'NOT_A_SIMULATION', message: 'Payload não é um formato de simulação reconhecido.' };
    }
    const parts = content.split('|');
    const partIndex = parseInt(parts[1], 10);
    const totalParts = parseInt(parts[2], 10);
    const sequenceId = parts[3];
    const payload = parts.slice(4).join('|');

    if (isNaN(partIndex) || isNaN(totalParts)) {
      return { code: 'INVALID_PARTS_INFO', message: 'Índice ou total inválido na simulação' };
    }

    return { partIndex, totalParts, sequenceId, payload };
  }

  reconstruct(partsContent: string[]) {
    if (partsContent.length === 0) return { code: 'NO_PARTS', message: 'Nenhuma parte' };
    const payloads = partsContent.map(content => {
      const parts = content.split('|');
      return parts.slice(4).join('|');
    });
    return payloads.join('');
  }

  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError {
    const sections = fullPayload.split('|');
    if (sections.length < 10) return { code: 'INCOMPLETE_PAYLOAD', message: 'Payload de simulação incompleto' };

    const [
      electionId,
      roundNumberStr,
      stateCode,
      cityCode,
      zoneCode,
      sectionCode,
      urnCode,
      votesStr,
      hash,
      signature
    ] = sections;

    const roundNumber = parseInt(roundNumberStr, 10);

    const votes: any[] = [];
    if (votesStr) {
      const voteEntries = votesStr.split(';');
      for (const entry of voteEntries) {
        if (!entry) continue;
        const [officeName, candidateNumber, partyNumber, type, quantityStr] = entry.split(',');
        const quantity = parseInt(quantityStr, 10);
        
        votes.push({
          officeName,
          candidateNumber: candidateNumber || undefined,
          partyNumber: partyNumber || undefined,
          type: type as any,
          quantity: isNaN(quantity) ? 0 : quantity,
        });
      }
    }

    return {
      electionId: `SIM-${electionId}`, // Força prefixo SIM
      roundNumber,
      stateCode,
      cityCode,
      zoneCode,
      sectionCode,
      urnCode: `SIM-${urnCode}`,
      votes,
      hash,
      signature,
      hashStatus: 'VERIFIED', // Simulation always verifies
      sigStatus: 'VERIFIED'
    };
  }
}

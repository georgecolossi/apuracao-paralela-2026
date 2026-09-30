import crypto from 'crypto';

export class Tse2026HashValidator {
  validate(reconstructedPayload: string, providedHashHex: string, rawParts?: string[]): 'VERIFIED' | 'INVALID' | 'UNAVAILABLE' {
    if (!providedHashHex) return 'UNAVAILABLE';
    
    if (!rawParts || rawParts.length === 0) {
      // O parser real exige rawParts para o cálculo preciso 
      return 'INVALID';
    }

    // TSE 2026 Official Cryptographic Algorithm
    // Sort parts
    const sortedParts = [...rawParts].sort((a, b) => {
      const idxA = parseInt(a.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
      const idxB = parseInt(b.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
      return idxA - idxB;
    });

    const processedParts = sortedParts.map((part, index) => {
      // Remove QRBU header
      let processed = part.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '');
      
      // Only for the last part, remove from HASH: onwards
      if (index === sortedParts.length - 1) {
        const hashIdx = processed.indexOf(' HASH:');
        if (hashIdx !== -1) {
          processed = processed.substring(0, hashIdx);
        }
      }
      return processed;
    });

    const hashInput = processedParts.join(' ');
    const computedHash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();

    if (computedHash === providedHashHex.toUpperCase()) {
      return 'VERIFIED';
    }

    return 'INVALID';
  }
}

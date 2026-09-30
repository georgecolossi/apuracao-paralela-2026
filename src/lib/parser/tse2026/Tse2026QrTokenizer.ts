export interface Tse2026QrToken {
  key: string;
  value: string;
  position: number;
  raw: string;
}

export class Tse2026QrTokenizer {
  tokenize(payload: string): Tse2026QrToken[] {
    const tokens: Tse2026QrToken[] = [];
    let position = 0;

    // As per TSE key:value space delimited
    // We match WORD:VALUE where VALUE can be until the next WORD: or end
    // Use regex to match key:value pairs. 
    // Format is like "VRQR:01.01 ORIG:BU MUNI:12345 ZONA:0123 ..."
    
    // Formato oficial de chave-valor do TSE é KEY:VALUE, onde KEY pode ser alfanumérico
    // Para candidatos, KEY é numérico puro (ex: 9202:1)
    const regex = /([A-Z0-9]+):(\S+)/g;
    let match;

    while ((match = regex.exec(payload)) !== null) {
      tokens.push({
        key: match[1],
        value: match[2],
        position: position++,
        raw: match[0]
      });
    }

    return tokens;
  }
}

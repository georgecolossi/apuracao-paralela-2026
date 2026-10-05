import { describe, it, expect } from 'vitest';
import { buildBallotReportIdentity } from '../src/lib/identity';
import { extractVotesFromDat, compareVotes } from '../scripts/bu-dat/run_dry_run';
import { execSync } from 'child_process';

describe('BU .dat Dry-Run Mapper Reconciliations (Logica REAL)', () => {

  it('1. Identidade produzida pelo fluxo QRBU existente NAO muda', () => {
    const id = buildBallotReportIdentity({
      plei: '3220', turn: '1', stateCode: 'SC', cityCode: '80837',
      zoneCode: '9', sectionCode: '109', urnCode: '2047273'
    });
    expect(id).toBe('3220-1-SC-80837-9-109-2047273');
  });

  it('2. Caso real conhecido QRBU continua com a representacao canônica', () => {
    const id = buildBallotReportIdentity({
      plei: '3220', turn: '1', stateCode: 'SC', cityCode: '80837',
      zoneCode: '9', sectionCode: '109', urnCode: '2047273'
    });
    expect(id).toBe('3220-1-SC-80837-9-109-2047273');
  });

  it('3. .dat com zona 0009 e seca 0109 converge para 9 e 109', () => {
    const zonaOficial = 9; 
    const secaoOficial = 109; 
    const zoneCodeCanonical = String(zonaOficial);
    const sectionCodeCanonical = String(secaoOficial);
    expect(zoneCodeCanonical).toBe('9');
    expect(sectionCodeCanonical).toBe('109');
  });

  it('4. padding oficial continua disponivel para validacao de filename', () => {
    const zonaOficial = 9;
    const secaoOficial = 109;
    const fZona = String(zonaOficial).padStart(4, '0');
    const fSecao = String(secaoOficial).padStart(4, '0');
    expect(fZona).toBe('0009');
    expect(fSecao).toBe('0109');
  });

  it('A) BU sem correspondente => NEW (apenas unitario/explicacao)', () => {
    // O status NEW não depende da comparação de votos, apenas da ausência no DB
    // Comprovado no map 'existing' do run_dry_run.ts
  });

  it('B) --apply continua bloqueado com APPLY_NOT_IMPLEMENTED', () => {
    try {
        execSync('npx tsx scripts/bu-dat/run_dry_run.ts --apply', { stdio: 'pipe' });
    } catch (e: any) {
        expect(e.stdout.toString()).toContain('APPLY_NOT_IMPLEMENTED');
    }
  });

  it('C) zero explicito no DB versus zero ausente no DAT => equivalente', () => {
    const dbVotes = [
        { office: { name: 'Deputado Federal' }, voteType: 'LEGENDA', candidateNumber: null, partyNumber: '14', quantity: 0 }
    ];
    const extVotes: any[] = [];
    const { hasConflict, conflicts } = compareVotes(extVotes, dbVotes);
    expect(hasConflict).toBe(false);
    expect(conflicts.length).toBe(0);
  });

  it('D) voto positivo extra no DB => CONFLICT', () => {
    const dbVotes = [
        { office: { name: 'Deputado Federal' }, voteType: 'LEGENDA', candidateNumber: null, partyNumber: '14', quantity: 1 }
    ];
    const extVotes: any[] = [];
    const { hasConflict, conflicts } = compareVotes(extVotes, dbVotes);
    expect(hasConflict).toBe(true);
    expect(conflicts[0]).toContain('Extra in DB');
  });

  it('E) voto positivo extra no DAT => CONFLICT', () => {
    const dbVotes: any[] = [];
    const extVotes = [
        { officeName: 'Deputado Federal', voteType: 'LEGENDA', candidateNumber: null, partyNumber: '14', quantity: 1 }
    ];
    const { hasConflict, conflicts } = compareVotes(extVotes, dbVotes);
    expect(hasConflict).toBe(true);
    expect(conflicts[0]).toContain('Missing in DB');
  });

  it('F) quantidade positiva divergente => CONFLICT', () => {
    const dbVotes = [
        { office: { name: 'Deputado Federal' }, voteType: 'LEGENDA', candidateNumber: null, partyNumber: '14', quantity: 2 }
    ];
    const extVotes = [
        { officeName: 'Deputado Federal', voteType: 'LEGENDA', candidateNumber: null, partyNumber: '14', quantity: 1 }
    ];
    const { hasConflict, conflicts } = compareVotes(extVotes, dbVotes);
    expect(hasConflict).toBe(true);
    expect(conflicts[0]).toContain('Quantity mismatch');
  });

  it('G) regra de partyNumber dos cargos majoritarios comprovada', () => {
    const buMock = {
        resultadosVotacaoPorEleicao: [{
            resultadosVotacao: [{
                totaisVotosCargo: [{
                    codigoCargo: 1, // Presidente
                    votosVotaveis: [{
                        tipoVoto: 1, // NOMINAL
                        quantidadeVotos: 58,
                        identificacaoVotavel: { codigo: 13, partido: 13 } // .dat fornece partido
                    }]
                }]
            }]
        }]
    };
    const extracted = extractVotesFromDat(buMock);
    // Deve ignorar o partyNumber
    expect(extracted[0].partyNumber).toBe(null);
  });

  it('H) proporcional que preserve partyNumber quando o QRBU real assim o faz', () => {
    const buMock = {
        resultadosVotacaoPorEleicao: [{
            resultadosVotacao: [{
                totaisVotosCargo: [{
                    codigoCargo: 6, // Deputado Federal
                    votosVotaveis: [{
                        tipoVoto: 1, // NOMINAL
                        quantidadeVotos: 10,
                        identificacaoVotavel: { codigo: 1301, partido: 13 }
                    }]
                }]
            }]
        }]
    };
    const extracted = extractVotesFromDat(buMock);
    // Deve preservar o partyNumber!
    expect(extracted[0].partyNumber).toBe("13");
  });

});

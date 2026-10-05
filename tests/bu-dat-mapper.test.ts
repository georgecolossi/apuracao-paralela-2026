import { describe, it, expect } from 'vitest';
import { buildNewPayload } from '../scripts/bu-dat/run_dry_run';

describe('BU DAT Mapper - buildNewPayload', () => {
  it('C) buildNewPayload constroi o payload corretamente para um NEW', () => {
    const extractedVotes = [{ officeName: 'PRESIDENTE', candidateNumber: '13', partyNumber: '13', voteType: 'NOMINAL', quantity: 10 }];
    const payload = buildNewPayload('3220', '1', 'SC', '80837', '0009', '0001', '12345', extractedVotes);
    
    expect(payload.electionId).toBe('3220');
    expect(payload.roundNumber).toBe(1);
    expect(payload.stateCode).toBe('SC');
    expect(payload.cityCode).toBe('80837');
    expect(payload.zoneCode).toBe('0009');
    expect(payload.sectionCode).toBe('0001');
    expect(payload.urnCode).toBe('12345');
    expect(Array.isArray(payload.votes)).toBe(true);
    expect(payload.votes.length).toBe(1);
    expect(payload.votes[0].officeName).toBe('PRESIDENTE');
  });
});

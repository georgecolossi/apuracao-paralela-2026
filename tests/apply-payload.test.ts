import { describe, it, expect } from 'vitest';
import { prepareNewReportsForApply } from '../scripts/bu-dat/run_dry_run';

describe('prepareNewReportsForApply - Bug Regression & Path Testing', () => {
  it('A) Positive path: valid payload is prepared correctly', () => {
    const report = {
      new: 1,
      results: [
        {
          status: 'NEW',
          payload: {
            electionId: '3220',
            roundNumber: 1,
            stateCode: 'SC',
            cityCode: '80837',
            zoneCode: '0009',
            sectionCode: '0001',
            urnCode: '12345',
            votes: []
          }
        },
        {
          status: 'ALREADY_EXISTS'
        }
      ]
    };
    const prepared = prepareNewReportsForApply(report);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].status).toBe('NEW');
  });

  it('B) report.new = 0 and no NEW elements returns empty array', () => {
    const report = {
      new: 0,
      results: [
        { status: 'ALREADY_EXISTS' },
        { status: 'ALREADY_EXISTS' }
      ]
    };
    const prepared = prepareNewReportsForApply(report);
    expect(prepared).toEqual([]);
  });

  it('C) report.new > 0 but NEW without payload aborts (Silent No-Op Regression)', () => {
    const report = {
      new: 162,
      results: Array.from({ length: 162 }).map(() => ({
        status: 'NEW' // NO PAYLOAD
      }))
    };
    expect(() => prepareNewReportsForApply(report)).toThrow('APPLY_INVALID_PAYLOAD_STRUCTURE');
  });

  it('D) report.new > 0 but NEW with missing fields aborts', () => {
    const report = {
      new: 1,
      results: [
        {
          status: 'NEW',
          payload: {
            electionId: '3220',
            // Missing roundNumber
            votes: []
          }
        }
      ]
    };
    expect(() => prepareNewReportsForApply(report)).toThrow('APPLY_INVALID_PAYLOAD_STRUCTURE');
  });

  it('E) report.new = 162 but found fewer NEW elements aborts (Mismatch)', () => {
    const report = {
      new: 162,
      results: [
        { status: 'NEW', payload: { electionId: '3220', roundNumber: 1, stateCode: 'SC', cityCode: '1', zoneCode: '1', sectionCode: '1', urnCode: '1', votes: [] } }
      ] // Only 1 element
    };
    expect(() => prepareNewReportsForApply(report)).toThrow('APPLY_NEW_PAYLOAD_COUNT_MISMATCH');
  });
});

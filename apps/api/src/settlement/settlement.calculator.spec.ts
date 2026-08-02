import {
  calculateSettlement,
  DEFAULT_SETTLEMENT_FEE_BASIS_POINTS,
  MAX_SETTLEMENT_MINOR_AMOUNT,
} from './settlement.calculator';

describe('Settlement calculation', () => {
  it('uses deterministic integer fee, refund, and adjustment arithmetic', () => {
    expect(
      calculateSettlement({
        grossAmountMinor: 10_001,
        refunds: [1_000, 250],
        adjustments: [75, -25],
      }),
    ).toEqual({
      grossAmountMinor: 10_001,
      feeBasisPoints: DEFAULT_SETTLEMENT_FEE_BASIS_POINTS,
      feeAmountMinor: 250,
      refundAmountMinor: 1_250,
      adjustmentAmountMinor: 50,
      payableAmountMinor: 8_551,
    });
  });

  it('rejects negative payable and unsafe or overflowing inputs', () => {
    expect(() =>
      calculateSettlement({
        grossAmountMinor: 100,
        feeBasisPoints: 10_000,
        refundAmountMinor: 1,
      }),
    ).toThrow('payable amount cannot be negative');

    expect(() =>
      calculateSettlement({
        grossAmountMinor: MAX_SETTLEMENT_MINOR_AMOUNT + 1,
      }),
    ).toThrow('grossAmountMinor');

    expect(() =>
      calculateSettlement({
        grossAmountMinor: 100,
        adjustments: [MAX_SETTLEMENT_MINOR_AMOUNT, 1],
      }),
    ).toThrow('adjustment total');
  });

  it('rejects refunds greater than the gross amount', () => {
    expect(() =>
      calculateSettlement({
        orderAmountMinor: 500,
        refundAmountMinor: 501,
      }),
    ).toThrow('refund amount cannot exceed gross amount');
  });
});

export const MAX_SETTLEMENT_MINOR_AMOUNT = 2_147_483_647;
export const SETTLEMENT_FEE_DENOMINATOR_BASIS_POINTS = 10_000;
export const DEFAULT_SETTLEMENT_FEE_BASIS_POINTS = 250;

export type SettlementCalculationInput = Readonly<{
  grossAmountMinor?: number;
  orderAmountMinor?: number;
  feeBasisPoints?: number;
  refundAmountMinor?: number;
  refunds?: readonly number[];
  adjustmentAmountMinor?: number;
  adjustments?: readonly number[];
}>;

export type SettlementCalculation = Readonly<{
  grossAmountMinor: number;
  feeBasisPoints: number;
  feeAmountMinor: number;
  refundAmountMinor: number;
  adjustmentAmountMinor: number;
  payableAmountMinor: number;
}>;

function requireSafeInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function sumRefunds(input: SettlementCalculationInput): bigint {
  let total = BigInt(
    requireSafeInteger(
      input.refundAmountMinor ?? 0,
      'refundAmountMinor',
      0,
      MAX_SETTLEMENT_MINOR_AMOUNT,
    ),
  );
  for (const [index, refund] of (input.refunds ?? []).entries()) {
    total += BigInt(
      requireSafeInteger(
        refund,
        `refunds[${index}]`,
        0,
        MAX_SETTLEMENT_MINOR_AMOUNT,
      ),
    );
  }
  return total;
}

function sumAdjustments(input: SettlementCalculationInput): bigint {
  let total = BigInt(
    requireSafeInteger(
      input.adjustmentAmountMinor ?? 0,
      'adjustmentAmountMinor',
      -MAX_SETTLEMENT_MINOR_AMOUNT,
      MAX_SETTLEMENT_MINOR_AMOUNT,
    ),
  );
  for (const [index, adjustment] of (input.adjustments ?? []).entries()) {
    total += BigInt(
      requireSafeInteger(
        adjustment,
        `adjustments[${index}]`,
        -MAX_SETTLEMENT_MINOR_AMOUNT,
        MAX_SETTLEMENT_MINOR_AMOUNT,
      ),
    );
  }
  if (
    total < BigInt(-MAX_SETTLEMENT_MINOR_AMOUNT) ||
    total > BigInt(MAX_SETTLEMENT_MINOR_AMOUNT)
  ) {
    throw new RangeError('adjustment total is outside the supported bounds');
  }
  return total;
}

function toSupportedNumber(value: bigint, field: string): number {
  const minimum = BigInt(-MAX_SETTLEMENT_MINOR_AMOUNT);
  const maximum = BigInt(MAX_SETTLEMENT_MINOR_AMOUNT);
  if (value < minimum || value > maximum) {
    throw new RangeError(`${field} is outside the supported bounds`);
  }
  return Number(value);
}

/**
 * v1 policy: withhold floor(gross * feeBasisPoints / 10,000) minor units.
 * The default 250 basis points is a 2.5% fee. BigInt arithmetic keeps the
 * calculation safe even when inputs are close to the PostgreSQL integer bound.
 */
export function calculateSettlement(
  input: SettlementCalculationInput,
): SettlementCalculation {
  const grossAmountMinor = requireSafeInteger(
    input.grossAmountMinor ?? input.orderAmountMinor,
    'grossAmountMinor',
    0,
    MAX_SETTLEMENT_MINOR_AMOUNT,
  );
  const feeBasisPoints = requireSafeInteger(
    input.feeBasisPoints ?? DEFAULT_SETTLEMENT_FEE_BASIS_POINTS,
    'feeBasisPoints',
    0,
    SETTLEMENT_FEE_DENOMINATOR_BASIS_POINTS,
  );
  const refundAmountMinor = sumRefunds(input);
  const adjustmentAmountMinor = sumAdjustments(input);
  const gross = BigInt(grossAmountMinor);
  const fee =
    (gross * BigInt(feeBasisPoints)) /
    BigInt(SETTLEMENT_FEE_DENOMINATOR_BASIS_POINTS);

  if (refundAmountMinor > gross) {
    throw new RangeError('refund amount cannot exceed gross amount');
  }

  const payable = gross - fee - refundAmountMinor + adjustmentAmountMinor;
  if (payable < 0n) {
    throw new RangeError('settlement payable amount cannot be negative');
  }

  return {
    grossAmountMinor,
    feeBasisPoints,
    feeAmountMinor: toSupportedNumber(fee, 'fee amount'),
    refundAmountMinor: toSupportedNumber(refundAmountMinor, 'refund amount'),
    adjustmentAmountMinor: toSupportedNumber(
      adjustmentAmountMinor,
      'adjustment amount',
    ),
    payableAmountMinor: toSupportedNumber(payable, 'payable amount'),
  };
}

export function configuredSettlementFeeBasisPoints(
  value = process.env.SETTLEMENT_FEE_BASIS_POINTS,
): number {
  if (value === undefined) {
    return DEFAULT_SETTLEMENT_FEE_BASIS_POINTS;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > SETTLEMENT_FEE_DENOMINATOR_BASIS_POINTS
  ) {
    return DEFAULT_SETTLEMENT_FEE_BASIS_POINTS;
  }
  return parsed;
}

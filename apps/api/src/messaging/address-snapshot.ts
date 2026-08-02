export type AddressSnapshot = Readonly<{
  line1: string;
  city: string;
  postalCode: string;
  country: string;
  recipientName?: string;
  line2?: string;
  state?: string;
}>;

type AddressRecord = Record<string, unknown>;

const MAX_ADDRESS_FIELD_LENGTH = 200;
const COUNTRY_PATTERN = /^[A-Z]{2,3}$/;

function isRecord(value: unknown): value is AddressRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstValue(record: AddressRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength = MAX_ADDRESS_FIELD_LENGTH,
): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Address ${field} is required`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`Address ${field} is invalid`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength = MAX_ADDRESS_FIELD_LENGTH,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredText(value, field, maxLength);
}

/**
 * Converts the accepted order input shape into the immutable Delivery
 * contract. A missing value is supported for orders created before delivery
 * addresses were introduced; Delivery rejects such events rather than
 * creating a delivery with an incomplete destination.
 */
export function normalizeAddressSnapshot(
  value: unknown,
): AddressSnapshot | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new TypeError('Address must be an object');
  }

  const recipientName = optionalText(
    firstValue(value, ['recipientName', 'name']),
    'recipient name',
  );
  const line1 = requiredText(
    firstValue(value, ['line1', 'addressLine1', 'street']),
    'line 1',
  );
  const line2 = optionalText(
    firstValue(value, ['line2', 'addressLine2']),
    'line 2',
  );
  const city = requiredText(firstValue(value, ['city']), 'city');
  const state = optionalText(firstValue(value, ['state', 'region']), 'state');
  const postalCode = requiredText(
    firstValue(value, ['postalCode', 'zipCode', 'zip']),
    'postal code',
  );
  const country = requiredText(
    firstValue(value, ['country', 'countryCode']),
    'country',
    3,
  ).toUpperCase();

  if (!COUNTRY_PATTERN.test(country)) {
    throw new TypeError('Address country is invalid');
  }

  const snapshot = {
    line1,
    city,
    postalCode,
    country,
    ...(recipientName === null ? {} : { recipientName }),
    ...(line2 === null ? {} : { line2 }),
    ...(state === null ? {} : { state }),
  };
  return Object.freeze(snapshot);
}

export function addressSnapshotsEqual(
  left: AddressSnapshot | null,
  right: AddressSnapshot | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

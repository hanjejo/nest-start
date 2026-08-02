import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const REFRESH_TOKEN_BYTES = 32;
const SCRYPT_MAX_MEMORY_BYTES = 32 * 1024 * 1024;

const dummyPasswordHash = [
  'scrypt',
  SCRYPT_COST,
  SCRYPT_BLOCK_SIZE,
  SCRYPT_PARALLELIZATION,
  Buffer.alloc(PASSWORD_SALT_BYTES).toString('base64url'),
  Buffer.alloc(PASSWORD_KEY_BYTES).toString('base64url'),
].join('$');

function derivePasswordKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      keyLength,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = await derivePasswordKey(
    password,
    salt,
    PASSWORD_KEY_BYTES,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
  );

  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  const hashToVerify = storedHash ?? dummyPasswordHash;
  const [
    algorithm,
    costValue,
    blockSizeValue,
    parallelizationValue,
    saltValue,
    keyValue,
  ] = hashToVerify.split('$');

  if (
    algorithm !== 'scrypt' ||
    !costValue ||
    !blockSizeValue ||
    !parallelizationValue ||
    !saltValue ||
    !keyValue
  ) {
    return false;
  }

  const cost = Number(costValue);
  const blockSize = Number(blockSizeValue);
  const parallelization = Number(parallelizationValue);
  const salt = Buffer.from(saltValue, 'base64url');
  const expectedKey = Buffer.from(keyValue, 'base64url');

  if (
    !Number.isSafeInteger(cost) ||
    !Number.isSafeInteger(blockSize) ||
    !Number.isSafeInteger(parallelization) ||
    salt.length < PASSWORD_SALT_BYTES ||
    expectedKey.length !== PASSWORD_KEY_BYTES
  ) {
    return false;
  }

  try {
    const actualKey = await derivePasswordKey(
      password,
      salt,
      expectedKey.length,
      cost,
      blockSize,
      parallelization,
    );
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken, 'utf8').digest('hex');
}

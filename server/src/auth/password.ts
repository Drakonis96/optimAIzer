import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_KEY_LENGTH = 64;

const toBuffer = (value: string): Buffer => Buffer.from(value, 'base64url');

export const hashPassword = (password: string): { salt: string; hash: string } => {
  const saltBuffer = randomBytes(16);
  const hashBuffer = scryptSync(password, saltBuffer, SCRYPT_KEY_LENGTH);

  return {
    salt: saltBuffer.toString('base64url'),
    hash: hashBuffer.toString('base64url'),
  };
};

export const verifyPassword = (password: string, salt: string, hash: string): boolean => {
  try {
    const saltBuffer = toBuffer(salt);
    const expectedHashBuffer = toBuffer(hash);
    const computedHashBuffer = scryptSync(password, saltBuffer, expectedHashBuffer.length);
    if (computedHashBuffer.length !== expectedHashBuffer.length) return false;
    return timingSafeEqual(computedHashBuffer, expectedHashBuffer);
  } catch {
    return false;
  }
};

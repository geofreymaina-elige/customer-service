import * as crypto from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Helper to attempt AES-256-CBC decryption with candidate key, iv and ciphertext.
 * Returns decrypted UTF-8 string on success, or null on decryption failure (e.g. bad decrypt / padding error).
 */
function tryDecrypt(cipherBuf: Buffer, keyBuf: Buffer, ivBuf: Buffer): string | null {
  try {
    if (cipherBuf.length === 0 || keyBuf.length !== 32 || ivBuf.length !== 16) {
      return null;
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, ivBuf);
    const decrypted = Buffer.concat([
      decipher.update(cipherBuf),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Validates and decrypts an ASTPP token, then checks it matches the given id.
 *
 * Handles ASTPP / PHP legacy encryption quirks:
 *   - Key: SHA-256 hex string first 32 chars OR raw 32-byte binary SHA-256 digest
 *   - IV: SHA-256 hex string first 16 chars OR raw 16-byte binary SHA-256 digest
 *   - Ciphertext: Double Base64 (base64_encode(openssl_encrypt(...))) OR Single Base64
 *
 * @throws BadRequestException when token is absent, fails decryption, or decrypted id does not match.
 */
export function validateAndDecryptToken(
  id: string | number,
  token: string | undefined,
): string {
  const tokenKey = process.env.ASTPP_TOKEN_KEY;
  const ivKey = process.env.ASTPP_IV_KEY;

  if (!tokenKey || !ivKey) {
    throw new Error(
      '[AstppTokenUtil] ASTPP_TOKEN_KEY or ASTPP_IV_KEY is not configured',
    );
  }

  const cleanToken = token?.trim();
  if (!cleanToken) {
    throw new BadRequestException({
      status: false,
      error: 'Invalid key',
    });
  }

  const targetIdStr = String(id).trim();

  // Key candidates
  const keyHex = crypto.createHash('sha256').update(tokenKey, 'utf8').digest('hex');
  const candidateKeys = [
    Buffer.from(keyHex, 'utf8').subarray(0, 32), // PHP openssl default: first 32 chars of hex string
    crypto.createHash('sha256').update(tokenKey, 'utf8').digest(), // Raw 32-byte binary SHA-256
  ];

  // IV candidates
  const ivHex = crypto.createHash('sha256').update(ivKey, 'utf8').digest('hex');
  const candidateIvs = [
    Buffer.from(ivHex.substring(0, 16), 'utf8'), // PHP: substr(hash('sha256', $secret_iv), 0, 16)
    crypto.createHash('sha256').update(ivKey, 'utf8').digest().subarray(0, 16), // Raw 16-byte binary
  ];

  // Ciphertext candidates (double base64 vs single base64)
  const candidateCiphers: Buffer[] = [];
  try {
    // Double Base64: base64_encode(openssl_encrypt(...)) where openssl_encrypt already outputs base64
    const firstBase64 = Buffer.from(cleanToken, 'base64').toString('utf8');
    const doubleCipher = Buffer.from(firstBase64, 'base64');
    if (doubleCipher.length > 0) {
      candidateCiphers.push(doubleCipher);
    }
  } catch {
    // Ignore base64 decode errors
  }

  try {
    const singleCipher = Buffer.from(cleanToken, 'base64');
    if (singleCipher.length > 0) {
      candidateCiphers.push(singleCipher);
    }
  } catch {
    // Ignore base64 decode errors
  }

  let decryptedId: string | null = null;

  // Try all permutations
  for (const cipher of candidateCiphers) {
    for (const key of candidateKeys) {
      for (const iv of candidateIvs) {
        const result = tryDecrypt(cipher, key, iv);
        if (result !== null) {
          if (result.trim() === targetIdStr) {
            console.log(`[AstppTokenUtil] Token validated successfully for id: ${targetIdStr}`);
            return targetIdStr;
          }
          if (!decryptedId) {
            decryptedId = result.trim();
          }
        }
      }
    }
  }

  console.warn(
    `[AstppTokenUtil] Validation failed. Expected id: '${targetIdStr}', decrypted: '${decryptedId ?? 'FAILED_DECRYPT'}'`,
  );

  throw new BadRequestException({
    status: false,
    error: 'Invalid key',
  });
}

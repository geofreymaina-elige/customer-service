import * as crypto from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Validates and decrypts an ASTPP token, then checks it matches the given account ID.
 *
 * Supports both raw configuration keys and precomputed hex keys:
 *   - ASTPP_TOKEN_KEY_HEX (or sha256(ASTPP_TOKEN_KEY))
 *   - ASTPP_IV_HEX / ASTPP_IV_DERIVED (or substr(sha256(ASTPP_IV_KEY), 0, 16))
 *
 * Matches ASTPP PHP _token() implementation exactly:
 *   - AES key: First 32 ASCII characters of SHA-256 hex string
 *   - AES IV: 16 ASCII characters of derived IV string
 *   - Ciphertext: Double base64 decoded string
 *
 * @throws BadRequestException on decryption failure or id mismatch.
 */
export function validateAndDecryptToken(
  id: string | number,
  token: string | undefined,
): string {
  // 1. Resolve Key (prefer precomputed HEX if provided, else sha256 of ASTPP_TOKEN_KEY)
  const tokenKeyHex =
    process.env.ASTPP_TOKEN_KEY_HEX ||
    (process.env.ASTPP_TOKEN_KEY
      ? crypto.createHash('sha256').update(process.env.ASTPP_TOKEN_KEY, 'utf8').digest('hex')
      : '');

  // 2. Resolve IV (prefer derived string or hex if provided, else first 16 chars of sha256 of ASTPP_IV_KEY)
  let ivStr = process.env.ASTPP_IV_DERIVED || '';
  if (!ivStr && process.env.ASTPP_IV_HEX) {
    ivStr = Buffer.from(process.env.ASTPP_IV_HEX, 'hex').toString('utf8');
  }
  if (!ivStr && process.env.ASTPP_IV_KEY) {
    ivStr = crypto
      .createHash('sha256')
      .update(process.env.ASTPP_IV_KEY, 'utf8')
      .digest('hex')
      .substring(0, 16);
  }

  if (!tokenKeyHex || !ivStr) {
    throw new Error(
      '[AstppTokenUtil] ASTPP token keys are not configured. Please set ASTPP_TOKEN_KEY_HEX & ASTPP_IV_HEX (or ASTPP_TOKEN_KEY & ASTPP_IV_KEY)',
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

  // PHP OpenSSL uses first 32 ASCII characters of sha256 hex string:
  const aesKey = Buffer.from(tokenKeyHex.substring(0, 32), 'utf8');
  const aesIv = Buffer.from(ivStr.substring(0, 16), 'utf8');

  let tokenId: string | null = null;

  // Primary: standard double-base64 decode
  try {
    const innerBase64 = Buffer.from(cleanToken, 'base64').toString('utf8');
    const ciphertext = Buffer.from(innerBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesIv);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    tokenId = decrypted.toString('utf8');
  } catch (err: any) {
    // Attempt with padding or fallback
  }

  // Fallback: in case token was truncated by PHP's substr_replace($token, "", -2) when length was 32
  if (!tokenId && cleanToken.length === 30) {
    try {
      const innerBase64 = Buffer.from(cleanToken + '09', 'base64').toString('utf8');
      const ciphertext = Buffer.from(innerBase64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesIv);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      tokenId = decrypted.toString('utf8');
    } catch {
      // Ignore
    }
  }

  if (String(tokenId) !== targetIdStr) {
    console.warn(
      `[AstppTokenUtil] Validation failed. Expected id: '${targetIdStr}', decrypted: '${tokenId ?? 'FAILED'}'`,
    );
    throw new BadRequestException({
      status: false,
      error: 'Invalid key',
    });
  }

  console.log(`[AstppTokenUtil] Token successfully validated for account id: ${targetIdStr}`);
  return targetIdStr;
}

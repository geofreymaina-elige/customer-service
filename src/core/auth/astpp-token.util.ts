import * as crypto from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Validates and decrypts an ASTPP token, then checks it matches the given id.
 *
 * Algorithm (mirrors legacy PHP implementation):
 *   key  = sha256(ASTPP_TOKEN_KEY)        → hex string
 *   iv   = sha256(ASTPP_IV_KEY)[0..15]    → first 16 bytes
 *   token must be exactly 30 chars long   (base64-encoded AES-256-CBC ciphertext)
 *   decrypted value must equal String(id)
 *
 * @throws BadRequestException  when token is absent, wrong length, fails decryption,
 *                               or decrypted id does not match.
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

  let tokenId: string | false = false;

  if (token) {
    try {
      // PHP: $key = hash('sha256', config_item('token_key'));
      const key = crypto
        .createHash('sha256')
        .update(tokenKey, 'utf8')
        .digest('hex');

      // PHP: $iv = substr(hash('sha256', $secret_iv), 0, 16);
      const iv = crypto
        .createHash('sha256')
        .update(ivKey, 'utf8')
        .digest('hex')
        .substring(0, 16);

      // PHP: if (strlen($string) == 30)
      if (token.length === 30) {
        // PHP: base64_decode($string) → then another base64_decode for the actual cipher
        const firstBase64 = Buffer.from(token, 'base64').toString('utf8');

        const aesKey = Buffer.from(key, 'utf8').subarray(0, 32);
        const aesIv = Buffer.from(iv, 'utf8');

        const encrypted = Buffer.from(firstBase64, 'base64');

        const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesIv);

        const decrypted = Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]);

        tokenId = decrypted.toString('utf8');
      }
      // else tokenId stays false
    } catch (error) {
      console.error(
        `[AstppTokenUtil] Decryption error: ${error instanceof Error ? error.message : error}`,
      );
      tokenId = false;
    }
  }

  // PHP: if ($this->postdata['id'] != $token_id)
  if (String(id) !== String(tokenId)) {
    throw new BadRequestException({
      status: false,
      error: 'Invalid key',
    });
  }

  return String(tokenId);
}

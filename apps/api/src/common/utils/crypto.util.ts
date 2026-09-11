import { createHash, randomBytes } from 'crypto';

export class CryptoUtil {
  static sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  static randomString(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  static generateApiKey(prefix = 'orn_live_'): { key: string; hash: string; prefix: string } {
    const raw = randomBytes(24).toString('base64url');
    const key = `${prefix}${raw}`;
    const hash = this.sha256(key);
    return {
      key,
      hash,
      prefix: key.substring(0, 12),
    };
  }
}

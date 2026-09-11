export interface ICursorPayload {
  id: string;
  sortByValue?: string | number | Date;
  timestamp: number;
}

export class CursorUtil {
  /**
   * Encodes a payload into a base64url cursor string
   */
  static encode(payload: ICursorPayload): string {
    const json = JSON.stringify(payload);
    return Buffer.from(json, 'utf8').toString('base64url');
  }

  /**
   * Decodes a base64url cursor string into payload
   */
  static decode<T extends ICursorPayload = ICursorPayload>(cursor: string): T | null {
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf8');
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }
}

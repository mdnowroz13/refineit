// src/utils/hash.ts
import crypto from 'crypto';

/**
 * Hash utilities
 */

export function sha1(content: string | Buffer): string {
    return crypto.createHash('sha1').update(content).digest('hex');
}

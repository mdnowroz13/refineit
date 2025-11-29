import crypto from 'crypto';
export function sha1(content) {
    return crypto.createHash('sha1').update(content).digest('hex');
}
//# sourceMappingURL=hash.js.map
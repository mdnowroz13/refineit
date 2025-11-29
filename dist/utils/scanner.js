import { glob } from 'glob';
import path from 'path';
import { computeHashes } from './worker-scanner.js';
function normalizeAbsolute(p) {
    return path.resolve(p).replace(/\\/g, '/');
}
export async function getFiles(patterns, ignore = []) {
    const safeIgnore = [
        '.git/**',
        'node_modules/**',
        '.refineit-trash/**',
        'refineit-e2e/logs/**',
        'dist/**',
        'build/**',
        ...ignore
    ];
    const absoluteIgnores = [];
    for (const p of safeIgnore) {
        absoluteIgnores.push(p);
        try {
            const abs = path.resolve(process.cwd(), p).replace(/\\/g, '/');
            absoluteIgnores.push(abs);
        }
        catch (e) {
        }
    }
    const allFiles = [];
    for (const pattern of patterns) {
        const found = await glob(pattern, {
            ignore: absoluteIgnores,
            nodir: true,
            absolute: true,
        });
        for (const p of found) {
            if (p.includes('/.refineit/'))
                continue;
            allFiles.push(normalizeAbsolute(p));
        }
    }
    return Array.from(new Set(allFiles)).sort();
}
export async function getFilesWithHashes(patterns, ignore = [], concurrency) {
    const files = await getFiles(patterns, ignore);
    if (files.length === 0)
        return { files, hashes: {} };
    try {
        const hashes = await computeHashes(files, concurrency ?? Math.max(2, Math.floor(require('os').cpus().length / 2)));
        return { files, hashes };
    }
    catch (e) {
        const crypto = await import('crypto');
        const fs = await import('fs/promises');
        const fallbackHashes = {};
        for (const f of files) {
            try {
                const b = await fs.readFile(f);
                fallbackHashes[f] = crypto.createHash('sha256').update(b).digest('hex');
            }
            catch {
            }
        }
        return { files, hashes: fallbackHashes };
    }
}
//# sourceMappingURL=scanner.js.map
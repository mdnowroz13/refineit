import { glob } from 'glob';
import path from 'path';
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
        for (const p of found)
            allFiles.push(normalizeAbsolute(p));
    }
    return Array.from(new Set(allFiles)).sort();
}
//# sourceMappingURL=scanner.js.map
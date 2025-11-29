import { glob } from 'glob';
import path from 'path';

function normalizeAbsolute(p: string) {
    return path.resolve(p).replace(/\\/g, '/');
}

export async function getFiles(patterns: string[], ignore: string[] = []) {
    // Add safe default ignores
    const safeIgnore = [
        '.git/**',
        'node_modules/**',
        '.refineit-trash/**',
        'refineit-e2e/logs/**',
        'dist/**',
        'build/**',
        ...ignore
    ];

    // For absolute:true, include both absolute and relative ignore patterns
    const absoluteIgnores: string[] = [];
    for (const p of safeIgnore) {
        absoluteIgnores.push(p);
        try {
            const abs = path.resolve(process.cwd(), p).replace(/\\/g, '/');
            absoluteIgnores.push(abs);
        } catch (e) {
            // ignore
        }
    }

    const allFiles: string[] = [];

    for (const pattern of patterns) {
        const found = await glob(pattern, {
            ignore: absoluteIgnores,
            nodir: true,
            absolute: true,
        });
        for (const p of found) allFiles.push(normalizeAbsolute(p));
    }

    // Remove duplicates and sort for deterministic results
    return Array.from(new Set(allFiles)).sort();
}

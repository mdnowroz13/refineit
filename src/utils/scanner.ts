// src/utils/scanner.ts
import { glob } from 'glob';
import path from 'path';
import { existsSync } from 'fs';
import { computeHashes } from './worker-scanner.js';

function normalizeAbsolute(p: string) {
    return path.resolve(p).replace(/\\/g, '/');
}

/**
 * getFiles(patterns, ignore)
 * - returns absolute normalized file list (same as old implementation)
 */
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
        for (const p of found) {
            // skip files inside .refineit/cache (just to be safe)
            if (p.includes('/.refineit/')) continue;
            allFiles.push(normalizeAbsolute(p));
        }
    }

    // Remove duplicates and sort for deterministic results
    return Array.from(new Set(allFiles)).sort();
}

/**
 * getFilesWithHashes(patterns, ignore, concurrency)
 * - returns { files: string[], hashes: Record<string,string> }
 * - computes SHA256 hashes in parallel using worker threads
 */
export async function getFilesWithHashes(patterns: string[], ignore: string[] = [], concurrency?: number) {
    const files = await getFiles(patterns, ignore);
    if (files.length === 0) return { files, hashes: {} };

    try {
        // compute hashes using worker threads
        const hashes = await computeHashes(files, concurrency ?? Math.max(2, Math.floor(require('os').cpus().length / 2)));
        return { files, hashes };
    } catch (e) {
        // fallback: synchronous hashing (rare) using Node's crypto
        const crypto = await import('crypto');
        const fs = await import('fs/promises');
        const fallbackHashes: Record<string, string> = {};
        for (const f of files) {
            try {
                const b = await fs.readFile(f);
                fallbackHashes[f] = crypto.createHash('sha256').update(b).digest('hex');
            } catch {
                // ignore read errors
            }
        }
        return { files, hashes: fallbackHashes };
    }
}
